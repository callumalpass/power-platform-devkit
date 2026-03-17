import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { readJsonFile, sha256Hex, stableStringify, writeJsonFile } from '@pp/artifacts';
import {
  CloudFlowService as DataverseCloudFlowService,
  ConnectionReferenceService,
  EnvironmentVariableService,
  type CloudFlowRunActionSummary,
  type CloudFlowServiceOptions,
  type DataverseClient,
  type CloudFlowConnectionReference as DataverseCloudFlowConnectionReference,
  type CloudFlowInspectResult as DataverseCloudFlowInspectResult,
  type CloudFlowRecord as DataverseCloudFlowRecord,
  type CloudFlowRunRecord as DataverseCloudFlowRunRecord,
  type CloudFlowRunSummary as DataverseCloudFlowRunSummary,
  type ConnectionReferenceValidationResult,
  type EnvironmentVariableSummary,
} from '@pp/dataverse';
import { createDiagnostic, fail, ok, type Diagnostic, type OperationResult } from '@pp/diagnostics';
import { SolutionService, type SolutionSyncStatusResult } from '@pp/solution';
import {
  normalizeConnectorApiId,
  resolveFlowSupportedConnectorOperation,
  type FlowSupportedConnectorOperationParameter,
} from './connector-operation-registry';
import {
  asFlowJsonRecord,
  asRecord,
  cloneJsonValue,
  fileExists,
  normalizeFlowJsonRecord,
  normalizeFlowJsonValue,
  parseFlowPath,
  readBoolean,
  readNumber,
  readString,
  resolveFlowOutputPath,
  stripNoisyFlowValue,
  type FlowJsonValue,
} from './flow-json';

export type { FlowJsonValue } from './flow-json';

export interface FlowRecord extends DataverseCloudFlowRecord {}

export interface FlowConnectionReference extends DataverseCloudFlowConnectionReference {
  name: string;
  connectionReferenceLogicalName?: string;
  connectionId?: string;
  apiId?: string;
}

export interface FlowWorkflowShellMetadata {
  type?: number;
  mode?: number;
  onDemand?: boolean;
  primaryEntity?: string;
}

export type FlowWorkflowStateLabel = 'draft' | 'activated' | 'suspended';

export interface FlowSummary {
  id: string;
  name?: string;
  description?: string;
  uniqueName?: string;
  category?: number;
  workflowMetadata?: FlowWorkflowShellMetadata;
  workflowState?: FlowWorkflowStateLabel;
  stateCode?: number;
  statusCode?: number;
  definitionAvailable: boolean;
  connectionReferences: FlowConnectionReference[];
  parameters: string[];
  environmentVariables: string[];
}

export interface FlowInspectResult extends FlowSummary {
  clientData?: Record<string, FlowJsonValue>;
}

export interface FlowAttachResult {
  attached: true;
  solutionUniqueName: string;
  addRequiredComponents: boolean;
  flow: FlowSummary;
}

interface FlowActivationFailureDetails {
  flow: {
    id: string;
    name?: string;
    uniqueName?: string;
    category?: number;
    workflowState?: FlowWorkflowStateLabel;
    solutionUniqueName?: string;
    definitionAvailable: boolean;
    connectionReferences: string[];
    parameters: string[];
    environmentVariables: string[];
  };
  solutionSyncStatus?: {
    synchronization: SolutionSyncStatusResult['synchronization'];
    blockers: SolutionSyncStatusResult['blockers'];
    readBack: {
      summary: SolutionSyncStatusResult['readBack']['summary'];
      workflows: SolutionSyncStatusResult['readBack']['workflows'];
    };
    exportCheck: SolutionSyncStatusResult['exportCheck'];
  };
  solutionSyncStatusFailure?: {
    diagnostics: Diagnostic[];
    warnings: Diagnostic[];
    suggestedNextActions?: string[];
  };
}

export interface FlowArtifact {
  schemaVersion: 1;
  kind: 'pp.flow.artifact';
  metadata: {
    id?: string;
    name?: string;
    displayName?: string;
    description?: string;
    uniqueName?: string;
    category?: number;
    workflowMetadata?: FlowWorkflowShellMetadata;
    stateCode?: number;
    statusCode?: number;
    sourcePath?: string;
    connectionReferences: FlowConnectionReference[];
    parameters: Record<string, FlowJsonValue>;
    environmentVariables: string[];
  };
  definition: Record<string, FlowJsonValue>;
  clientData?: Record<string, FlowJsonValue>;
  unknown?: Record<string, FlowJsonValue>;
}

export interface FlowArtifactSummary {
  path: string;
  normalized: boolean;
  name?: string;
  definitionHash: string;
  connectionReferenceCount: number;
  parameterCount: number;
  environmentVariableCount: number;
}

export interface FlowValidationReport {
  valid: boolean;
  path: string;
  name?: string;
  connectionReferences: FlowConnectionReference[];
  parameters: string[];
  environmentVariables: string[];
  intermediateRepresentation: FlowIntermediateRepresentationSummary;
  semanticSummary: FlowSemanticSummary;
}

export interface FlowGraphNodeSummary {
  id: string;
  name: string;
  kind: FlowNodeKind;
  type?: string;
  path: string;
  parentId?: string;
  branch: FlowNodeBranch;
  childIds: string[];
  dependsOn: string[];
  unresolvedDependsOn: string[];
  dependentIds: string[];
  referenceCounts: {
    parameters: number;
    environmentVariables: number;
    connectionReferences: number;
    actions: number;
    variables: number;
  };
  variableUsage: {
    initializes: string[];
    reads: string[];
    writes: string[];
  };
}

export interface FlowGraphEdge {
  from: string;
  to: string;
  kind:
    | 'containment'
    | 'runAfter'
    | 'parameterReference'
    | 'environmentVariableReference'
    | 'connectionReferenceReference'
    | 'actionReference'
    | 'variableReference'
    | 'variableWrite';
  path?: string;
  resolved: boolean;
}

export interface FlowGraphResourceSummary {
  parameters: string[];
  environmentVariables: string[];
  connectionReferences: string[];
  variables: Array<{
    name: string;
    initializedBy: string[];
    readBy: string[];
    writtenBy: string[];
  }>;
}

export interface FlowGraphReport {
  artifactName?: string;
  summary: {
    nodeCount: number;
    triggerCount: number;
    actionCount: number;
    scopeCount: number;
    edgeCounts: Record<FlowGraphEdge['kind'], number>;
    unresolvedEdgeCount: number;
  };
  nodes: FlowGraphNodeSummary[];
  edges: FlowGraphEdge[];
  resources: FlowGraphResourceSummary;
  hotspots: Array<{
    kind: 'controlFanIn' | 'controlFanOut' | 'referenceDensity';
    nodeId: string;
    nodeName: string;
    metric: number;
  }>;
}

export interface FlowPatchDocument {
  actions?: Record<string, string>;
  variables?: Record<string, string>;
  connectionReferences?: Record<string, string>;
  environmentVariables?: Record<string, string>;
  parameters?: Record<string, FlowJsonValue>;
  expressions?: Record<string, string>;
  values?: Record<string, FlowJsonValue>;
}

export interface FlowSemanticSummary {
  triggerCount: number;
  actionCount: number;
  scopeCount: number;
  expressionCount: number;
  templateExpressionCount: number;
  initializedVariables: string[];
  variableUsage: {
    reads: number;
    writes: number;
  };
  dynamicContentReferenceCount: number;
  controlFlowEdgeCount: number;
  referenceCounts: {
    parameters: number;
    environmentVariables: number;
    actions: number;
    variables: number;
    connectionReferences: number;
  };
}

export type FlowNodeKind = 'trigger' | 'action' | 'scope';

export type FlowNodeBranch = 'root' | 'actions' | 'else' | 'default' | `case:${string}`;

export interface FlowIntermediateNode {
  id: string;
  name: string;
  kind: FlowNodeKind;
  type?: string;
  path: string;
  parentId?: string;
  branch: FlowNodeBranch;
  runAfter: string[];
  childIds: string[];
  controlFlow: {
    dependsOn: string[];
    unresolvedDependsOn: string[];
    dependentIds: string[];
  };
  dataFlow: {
    expressions: FlowExpressionUsage[];
    reads: FlowDynamicContentReference[];
    writes: FlowVariableWrite[];
    dynamicContentReferences: FlowDynamicContentReference[];
  };
  variableUsage: {
    initializes: string[];
    reads: string[];
    writes: string[];
  };
}

export interface FlowIntermediateRepresentationSummary {
  nodeCount: number;
  triggerCount: number;
  actionCount: number;
  scopeCount: number;
  controlFlowEdgeCount: number;
  expressionCount: number;
  templateExpressionCount: number;
  dynamicContentReferenceCount: number;
  variableReadCount: number;
  variableWriteCount: number;
}

export interface FlowIntermediateRepresentation extends FlowIntermediateRepresentationSummary {
  artifactName?: string;
  nodes: FlowIntermediateNode[];
}

export interface FlowUnpackResult {
  inputPath: string;
  outPath: string;
  summary: FlowArtifactSummary;
}

export interface FlowPackResult {
  path: string;
  outPath: string;
  format: 'raw-json';
  summary: FlowArtifactSummary;
}

const FLOW_WORKFLOW_STATE_DEFAULT_STATUS = new Map<number, number>([
  [0, 1],
  [1, 2],
  [2, 3],
]);
const FLOW_WORKFLOW_STATE_LABEL_STATE = new Map<FlowWorkflowStateLabel, number>([
  ['draft', 0],
  ['activated', 1],
  ['suspended', 2],
]);
const SUPPORTED_FLOW_WORKFLOW_CATEGORY = 5;
const SUPPORTED_FLOW_WORKFLOW_TYPE = 1;
const SUPPORTED_FLOW_WORKFLOW_MODE = 0;
const SUPPORTED_FLOW_WORKFLOW_ON_DEMAND = false;
const SUPPORTED_FLOW_WORKFLOW_PRIMARY_ENTITY = 'none';

const FLOW_WORKFLOW_STATUS_STATE = new Map<number, number>(
  Array.from(FLOW_WORKFLOW_STATE_DEFAULT_STATUS.entries()).map(([stateCode, statusCode]) => [statusCode, stateCode] as const)
);

export interface FlowExportResult {
  identifier: string;
  outPath: string;
  source: {
    id: string;
    name?: string;
    description?: string;
    uniqueName?: string;
    category?: number;
    workflowMetadata?: FlowWorkflowShellMetadata;
    workflowState?: FlowWorkflowStateLabel;
    stateCode?: number;
    statusCode?: number;
    solutionUniqueName?: string;
  };
  summary: FlowArtifactSummary;
}

export interface FlowDeployOptions {
  target?: string;
  solutionUniqueName?: string;
  createIfMissing?: boolean;
  workflowState?: FlowWorkflowStateLabel;
}

export interface FlowDeployResult {
  path: string;
  targetIdentifier: string;
  operation: 'created' | 'updated';
  target: {
    id: string;
    name?: string;
    description?: string;
    uniqueName?: string;
    category?: number;
    workflowMetadata?: FlowWorkflowShellMetadata;
    workflowState?: FlowWorkflowStateLabel;
    stateCode?: number;
    statusCode?: number;
    solutionUniqueName?: string;
  };
  updatedFields: string[];
  summary: FlowArtifactSummary;
  validation: {
    valid: true;
    warningCount: number;
  };
}

function buildFlowDeploySuccessMetadata(
  result: Pick<FlowDeployResult, 'targetIdentifier' | 'target'>,
  metadata: {
    supportTier: 'preview';
    diagnostics?: Diagnostic[];
    warnings?: Diagnostic[];
    knownLimitations?: string[];
    provenance?: Array<{ kind: 'official-api'; source: string }>;
  }
): {
  supportTier: 'preview';
  diagnostics?: Diagnostic[];
  warnings?: Diagnostic[];
  suggestedNextActions?: string[];
  knownLimitations?: string[];
  provenance?: Array<{ kind: 'official-api'; source: string }>;
} {
  const runnability = describeFlowDeployRunnabilityFollowUp(result.targetIdentifier, result.target);
  return {
    ...metadata,
    warnings: [...(metadata.warnings ?? []), ...(runnability.warning ? [runnability.warning] : [])],
    suggestedNextActions: runnability.suggestedNextActions,
  };
}

function describeFlowDeployRunnabilityFollowUp(
  targetIdentifier: string,
  target: FlowDeployResult['target']
): {
  warning?: Diagnostic;
  suggestedNextActions?: string[];
} {
  if (target.workflowState !== 'draft' && target.workflowState !== 'suspended') {
    return {};
  }

  const stateLabel = target.workflowState ?? 'unknown';
  const resolvedIdentifier = target.uniqueName ?? targetIdentifier;
  const inspectCommand = `pp flow inspect ${resolvedIdentifier} --environment <alias>${target.solutionUniqueName ? ` --solution ${target.solutionUniqueName}` : ''} --format json`;
  const activateCommand = `pp flow activate ${resolvedIdentifier} --environment <alias>${target.solutionUniqueName ? ` --solution ${target.solutionUniqueName}` : ''} --format json`;
  const syncStatusCommand = target.solutionUniqueName
    ? `pp solution sync-status ${target.solutionUniqueName} --environment <alias> --format json`
    : undefined;
  const stateParts: string[] = [];
  if (target.stateCode !== undefined) {
    stateParts.push(`statecode=${target.stateCode}`);
  }
  if (target.statusCode !== undefined) {
    stateParts.push(`statuscode=${target.statusCode}`);
  }

  return {
    warning: createDiagnostic(
      'warning',
      'FLOW_DEPLOY_TARGET_NOT_RUNNABLE',
      `Flow ${target.name ?? resolvedIdentifier} was deployed, but the remote workflow is still ${stateLabel}, so downstream runtime or solution-readiness checks may remain blocked.`,
      {
        source: '@pp/flow',
        detail: `${resolvedIdentifier} state=${stateLabel}${stateParts.length > 0 ? ` (${stateParts.join(', ')})` : ''}`,
        hint: syncStatusCommand ?? inspectCommand,
      }
    ),
    suggestedNextActions: dedupeStrings([
      `Run \`${inspectCommand}\` to confirm the remote workflow state and definition availability after deploy.`,
      `Run \`${activateCommand}\` for one bounded in-place activation attempt when this workflow should already be runnable.`,
      syncStatusCommand
        ? `Run \`${syncStatusCommand}\` to confirm whether this ${stateLabel} workflow is still blocking solution export readiness.`
        : undefined,
    ].filter((value): value is string => Boolean(value))),
  };
}

export interface FlowPromoteOptions {
  sourceSolutionUniqueName?: string;
  targetSolutionUniqueName?: string;
  target?: string;
  createIfMissing?: boolean;
  workflowState?: FlowWorkflowStateLabel;
  solutionPackage?: boolean;
  solutionPackageManaged?: boolean;
  publishWorkflows?: boolean;
  overwriteUnmanagedCustomizations?: boolean;
  holdingSolution?: boolean;
  skipProductUpdateDependencies?: boolean;
  importJobId?: string;
  targetDataverseClient?: DataverseClient;
}

export interface FlowArtifactPromoteResult {
  identifier: string;
  source: {
    id: string;
    name?: string;
    description?: string;
    uniqueName?: string;
    category?: number;
    workflowMetadata?: FlowWorkflowShellMetadata;
    workflowState?: FlowWorkflowStateLabel;
    stateCode?: number;
    statusCode?: number;
    solutionUniqueName?: string;
  };
  targetIdentifier: string;
  operation: 'updated' | 'created';
  target: {
    id: string;
    name?: string;
    description?: string;
    uniqueName?: string;
    category?: number;
    workflowMetadata?: FlowWorkflowShellMetadata;
    workflowState?: FlowWorkflowStateLabel;
    stateCode?: number;
    statusCode?: number;
    solutionUniqueName?: string;
  };
  summary: FlowArtifactSummary;
  validation: {
    valid: true;
    warningCount: number;
  };
  promotionMode: 'artifact';
}

export interface FlowSolutionPackagePromoteResult {
  identifier: string;
  source: {
    id: string;
    name?: string;
    description?: string;
    uniqueName?: string;
    category?: number;
    workflowMetadata?: FlowWorkflowShellMetadata;
    workflowState?: FlowWorkflowStateLabel;
    stateCode?: number;
    statusCode?: number;
    solutionUniqueName?: string;
  };
  operation: 'imported-solution';
  promotionMode: 'solution-package';
  targetSolutionUniqueName: string;
  solutionPackage: {
    packageType: 'managed' | 'unmanaged';
  };
  importOptions: {
    publishWorkflows: boolean;
    overwriteUnmanagedCustomizations: boolean;
    holdingSolution: boolean;
    skipProductUpdateDependencies: boolean;
    importJobId?: string;
  };
  summary: FlowArtifactSummary;
  validation: {
    valid: true;
    warningCount: number;
  };
}

export type FlowPromoteResult = FlowArtifactPromoteResult | FlowSolutionPackagePromoteResult;

export interface FlowPatchResult {
  path: string;
  outPath: string;
  changed: boolean;
  appliedOperations: string[];
  summary: FlowArtifactSummary;
}

export interface FlowRunRecord extends DataverseCloudFlowRunRecord {}

export interface FlowRunActionSummary {
  name: string;
  status?: string;
  startTime?: string;
  endTime?: string;
  durationMs?: number;
  code?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface FlowRunSummary {
  id: string;
  workflowId?: string;
  workflowName?: string;
  status?: string;
  startTime?: string;
  endTime?: string;
  durationMs?: number;
  retryCount?: number;
  errorCode?: string;
  errorMessage?: string;
  actions?: FlowRunActionSummary[];
}

export interface FlowErrorGroup {
  group: string;
  count: number;
  latestRunId?: string;
  latestStatus?: string;
  latestStartTime?: string;
  sampleErrorCode?: string;
  sampleErrorMessage?: string;
  averageDurationMs?: number;
  totalRetries: number;
  maxRetryCount: number;
}

export interface FlowConnectionHealthReport {
  flow: FlowInspectResult;
  sourceDefinition?: {
    available: boolean;
    artifactName?: string;
    nodeCount?: number;
    unresolvedEdgeCount?: number;
  };
  connectionReferences: Array<{
    name: string;
    valid: boolean;
    diagnostics: string[];
    recentFailures: number;
    sourceNodes: FlowSourceNodeLocation[];
  }>;
  environmentVariables: Array<{
    name: string;
    hasValue: boolean;
    recentFailures: number;
    sourceNodes: FlowSourceNodeLocation[];
  }>;
}

export interface FlowRuntimeStatusCount {
  status: string;
  count: number;
}

export interface FlowRuntimeDurationStats {
  min?: number;
  max?: number;
  average?: number;
  p50?: number;
  p95?: number;
}

export interface FlowRuntimeRetryStats {
  retriedRuns: number;
  totalRetries: number;
  maxRetryCount: number;
}

export interface FlowRuntimeDailyTrend {
  date: string;
  total: number;
  failed: number;
  succeeded: number;
  other: number;
  averageDurationMs?: number;
  totalRetries: number;
}

export interface FlowRuntimeAnalyticsSummary {
  statusCounts: FlowRuntimeStatusCount[];
  durationMs: FlowRuntimeDurationStats;
  retry: FlowRuntimeRetryStats;
  dailyTrends: FlowRuntimeDailyTrend[];
}

export interface FlowDoctorReport {
  flow?: FlowInspectResult;
  recentRuns: {
    total: number;
    failed: number;
    latestFailure?: FlowRunSummary;
  };
  runtimeSummary: FlowRuntimeAnalyticsSummary;
  errorGroups: FlowErrorGroup[];
  invalidConnectionReferences: ConnectionReferenceValidationResult[];
  missingEnvironmentVariables: EnvironmentVariableSummary[];
  sourceCorrelation?: {
    available: boolean;
    artifactName?: string;
    summary?: {
      nodeCount: number;
      unresolvedEdgeCount: number;
      connectionReferenceCount: number;
      environmentVariableCount: number;
      errorGroupCount: number;
    };
    connectionReferences: Array<{
      name: string;
      recentFailures: number;
      sourceNodes: FlowSourceNodeLocation[];
    }>;
    environmentVariables: Array<{
      name: string;
      hasValue: boolean;
      recentFailures: number;
      sourceNodes: FlowSourceNodeLocation[];
    }>;
    errorGroups: Array<{
      group: string;
      count: number;
      relatedConnectionReferences: string[];
      sourceNodes: FlowSourceNodeLocation[];
      heuristic: 'group-name' | 'message';
    }>;
  };
  findings: string[];
}

export interface FlowMonitorReport {
  checkedAt: string;
  observationWindow?: string;
  flow?: FlowInspectResult;
  health: {
    status: 'healthy' | 'degraded' | 'blocked' | 'inactive' | 'unknown';
    summary: string;
    telemetryState: 'active' | 'quiet' | 'blocked' | 'unknown';
    latestRunAt?: string;
  };
  recentRuns: {
    total: number;
    failed: number;
    latestFailure?: FlowRunSummary;
  };
  runtimeSummary: FlowRuntimeAnalyticsSummary;
  errorGroups: FlowErrorGroup[];
  invalidConnectionReferences: ConnectionReferenceValidationResult[];
  missingEnvironmentVariables: EnvironmentVariableSummary[];
  comparison?: FlowMonitorComparison;
  findings: string[];
}

export interface FlowMonitorComparison {
  baselineCheckedAt?: string;
  changed: boolean;
  health: {
    changed: boolean;
    previousStatus: FlowMonitorReport['health']['status'];
    currentStatus: FlowMonitorReport['health']['status'];
    previousTelemetryState: FlowMonitorReport['health']['telemetryState'];
    currentTelemetryState: FlowMonitorReport['health']['telemetryState'];
    previousLatestRunAt?: string;
    currentLatestRunAt?: string;
  };
  recentRuns: {
    totalDelta: number;
    failedDelta: number;
    latestFailureChanged: boolean;
    previousLatestFailure?: FlowRunSummary;
    currentLatestFailure?: FlowRunSummary;
  };
  errorGroups: {
    changed: boolean;
    added: FlowErrorGroup[];
    removed: FlowErrorGroup[];
    updated: Array<{
      group: string;
      previous: FlowErrorGroup;
      current: FlowErrorGroup;
    }>;
    unchangedCount: number;
  };
  findings: string[];
}

interface FlowNodeSummary {
  id: string;
  name: string;
  kind: FlowNodeKind;
  type?: string;
  path: string;
  parentId?: string;
  branch: FlowNodeBranch;
  runAfter: string[];
  childIds: string[];
  controlFlow: {
    dependsOn: string[];
    unresolvedDependsOn: string[];
    dependentIds: string[];
  };
  dataFlow: {
    expressions: FlowExpressionUsage[];
    reads: FlowDynamicContentReference[];
    writes: FlowVariableWrite[];
    dynamicContentReferences: FlowDynamicContentReference[];
  };
  variableUsage: {
    initializes: string[];
    reads: string[];
    writes: string[];
  };
}

export interface FlowSourceNodeLocation {
  id: string;
  name: string;
  kind: FlowNodeKind;
  type?: string;
  path: string;
}

interface FlowSourceCorrelationModel {
  artifactName?: string;
  graph: FlowGraphReport;
  connectionReferenceNodes: Map<string, FlowSourceNodeLocation[]>;
  environmentVariableNodes: Map<string, FlowSourceNodeLocation[]>;
}

interface FlowSemanticAnalysis {
  intermediateRepresentation: FlowIntermediateRepresentationSummary;
  summary: FlowSemanticSummary;
  diagnostics: Diagnostic[];
  warnings: Diagnostic[];
}

interface FlowStringLocation {
  value: string;
  path: string;
}

interface FlowDefinitionConnectionReference {
  name: string;
  connectionReferenceLogicalName?: string;
  apiId?: string;
}

interface FlowConnectorActionContract {
  apiId?: string;
  operationId?: string;
  connectionReferenceName?: string;
  connectionPath?: string;
  connectionReferenceSupported: boolean;
}

export interface FlowDynamicContentReference {
  kind: 'parameter' | 'environmentVariable' | 'action' | 'variable' | 'connectionReference';
  name: string;
  path: string;
}

export interface FlowExpressionUsage {
  path: string;
  syntax: 'expression' | 'template';
  expression: string;
  references: FlowDynamicContentReference[];
}

export interface FlowVariableWrite {
  name: string;
  path: string;
  operation: 'initialize' | 'set' | 'append' | 'increment' | 'decrement';
}

export class FlowService {
  constructor(private readonly dataverseClient?: DataverseClient, private readonly cloudFlowServiceOptions?: CloudFlowServiceOptions) {}

  async list(options: { solutionUniqueName?: string } = {}): Promise<OperationResult<FlowSummary[]>> {
    if (!this.dataverseClient) {
      return fail(
        createDiagnostic('error', 'FLOW_DATAVERSE_CLIENT_REQUIRED', 'Dataverse client is required for remote flow listing.', {
          source: '@pp/flow',
        })
      );
    }

    const workflows = await new DataverseCloudFlowService(this.dataverseClient, this.cloudFlowServiceOptions).list();

    if (!workflows.success) {
      return workflows as unknown as OperationResult<FlowSummary[]>;
    }

    let allowedIds: Set<string> | undefined;
    let diagnostics = workflows.diagnostics;
    let warnings = workflows.warnings;

    if (options.solutionUniqueName) {
      const components = await new SolutionService(this.dataverseClient).components(options.solutionUniqueName);

      if (!components.success) {
        return components as unknown as OperationResult<FlowSummary[]>;
      }

      allowedIds = new Set(
        (components.data ?? [])
          .filter((component) => component.componentType === 29 && component.objectId)
          .map((component) => component.objectId as string)
      );
      diagnostics = [...diagnostics, ...components.diagnostics];
      warnings = [...warnings, ...components.warnings];
    }

    const records = (workflows.data ?? []).filter((record) => !allowedIds || allowedIds.has(record.id)).map(normalizeRemoteFlow);

    return ok(records, {
      supportTier: 'preview',
      diagnostics,
      warnings,
    });
  }

  async inspect(identifier: string, options: { solutionUniqueName?: string } = {}): Promise<OperationResult<FlowInspectResult | undefined>> {
    const flows = await this.list(options);

    if (!flows.success) {
      return flows as unknown as OperationResult<FlowInspectResult | undefined>;
    }

    const match = (flows.data ?? []).find(
      (flow) => flow.id === identifier || flow.name === identifier || flow.uniqueName === identifier
    );

    return ok(match, {
      supportTier: 'preview',
      diagnostics: flows.diagnostics,
      warnings: flows.warnings,
    });
  }

  async attach(
    identifier: string,
    solutionUniqueName: string,
    options: { addRequiredComponents?: boolean } = {}
  ): Promise<OperationResult<FlowAttachResult>> {
    if (!this.dataverseClient) {
      return fail(
        createDiagnostic('error', 'FLOW_DATAVERSE_CLIENT_REQUIRED', 'Dataverse client is required for flow solution attachment.', {
          source: '@pp/flow',
        })
      );
    }

    const flow = await this.inspect(identifier);

    if (!flow.success) {
      return flow as unknown as OperationResult<FlowAttachResult>;
    }

    if (!flow.data) {
      return fail(
        [
          ...flow.diagnostics,
          createDiagnostic('error', 'FLOW_NOT_FOUND', `Flow ${identifier} was not found.`, {
            source: '@pp/flow',
          }),
        ],
        {
          supportTier: 'preview',
          warnings: flow.warnings,
        }
      );
    }

    const normalizedSolutionUniqueName = solutionUniqueName.trim();
    const addRequiredComponents = options.addRequiredComponents ?? true;
    const actionResult = await this.dataverseClient.invokeAction(
      'AddSolutionComponent',
      {
        ComponentId: flow.data.id,
        ComponentType: 29,
        SolutionUniqueName: normalizedSolutionUniqueName,
        AddRequiredComponents: addRequiredComponents,
      },
      {
        solutionUniqueName: normalizedSolutionUniqueName,
      }
    );

    if (!actionResult.success) {
      return actionResult as unknown as OperationResult<FlowAttachResult>;
    }

    return ok(
      {
        attached: true,
        solutionUniqueName: normalizedSolutionUniqueName,
        addRequiredComponents,
        flow: flow.data,
      },
      {
        supportTier: 'preview',
        diagnostics: mergeDiagnosticLists(flow.diagnostics, actionResult.diagnostics),
        warnings: mergeDiagnosticLists(flow.warnings, actionResult.warnings),
      }
    );
  }

  async runs(
    identifier: string,
    options: {
      solutionUniqueName?: string;
      status?: string;
      since?: string;
      includeActions?: boolean;
    } = {}
  ): Promise<OperationResult<FlowRunSummary[]>> {
    const flow = await this.inspect(identifier, options);

    if (!flow.success) {
      return flow as unknown as OperationResult<FlowRunSummary[]>;
    }

    if (!flow.data) {
      return ok([], {
        supportTier: 'experimental',
        diagnostics: flow.diagnostics,
        warnings: flow.warnings,
        suggestedNextActions: [
          'Run `pp flow list --environment <alias> --format json` to confirm the flow identifier before retrying runtime inspection.',
          `Run \`pp solution components ${options.solutionUniqueName ?? '<solution>'} --environment <alias> --format json\` if the flow is expected to be solution-scoped.`,
        ],
        knownLimitations: [
          'Flow runtime diagnostics require FlowRun ingestion to be available in the target environment.',
        ],
        provenance: [
          {
            kind: 'official-api',
            source: 'Dataverse workflows',
          },
        ],
      });
    }

    if (!this.dataverseClient) {
      return fail(
        createDiagnostic('error', 'FLOW_DATAVERSE_CLIENT_REQUIRED', 'Dataverse client is required for flow runtime diagnostics.', {
          source: '@pp/flow',
        })
      );
    }

    const runs = await new DataverseCloudFlowService(this.dataverseClient, this.cloudFlowServiceOptions).runs({
      workflowId: flow.data.id,
      workflowName: flow.data.name,
      workflowUniqueName: flow.data.uniqueName,
      status: options.status,
      since: options.since,
      includeActions: options.includeActions,
    });

    if (!runs.success) {
      return runs as unknown as OperationResult<FlowRunSummary[]>;
    }

    const filtered = (runs.data ?? []).map(normalizeFlowRun);
    const runtimeSchemaNotice = moveFlowRunSchemaWarningToKnownLimitations(runs.warnings);

    return ok(filtered, {
      supportTier: 'experimental',
      diagnostics: [...flow.diagnostics, ...runs.diagnostics],
      warnings: [...flow.warnings, ...runtimeSchemaNotice.warnings],
      suggestedNextActions: dedupeStrings(
        [
          filtered.length === 0
            ? `No recent runs were returned. Re-run \`pp flow doctor ${identifier} --environment <alias>${options.solutionUniqueName ? ` --solution ${options.solutionUniqueName}` : ''} --format json\` for richer runtime context.`
            : `Run \`pp flow doctor ${identifier} --environment <alias>${options.solutionUniqueName ? ` --solution ${options.solutionUniqueName}` : ''} --format json\` to correlate these runs with connection and environment-variable health.`,
          `Run \`pp flow inspect ${identifier} --environment <alias>${options.solutionUniqueName ? ` --solution ${options.solutionUniqueName}` : ''} --format json\` to confirm the resolved workflow identity.`,
        ]
      ),
      knownLimitations: [
        'FlowRun data may be delayed or incomplete depending on ingestion and retention settings.',
        ...runtimeSchemaNotice.knownLimitations,
      ],
      provenance: [
        {
          kind: 'official-api',
          source: 'Dataverse workflows',
        },
        {
          kind: 'official-api',
          source: 'Dataverse FlowRun history',
        },
      ],
    });
  }

  async errors(
    identifier: string,
    options: {
      solutionUniqueName?: string;
      status?: string;
      since?: string;
      groupBy?: 'errorCode' | 'errorMessage' | 'connectionReference';
    } = {}
  ): Promise<OperationResult<FlowErrorGroup[]>> {
    const runs = await this.runs(identifier, {
      solutionUniqueName: options.solutionUniqueName,
      status: options.status ?? 'Failed',
      since: options.since,
    });

    if (!runs.success) {
      return runs as unknown as OperationResult<FlowErrorGroup[]>;
    }

    const flow = await this.inspect(identifier, {
      solutionUniqueName: options.solutionUniqueName,
    });

    if (!flow.success) {
      return flow as unknown as OperationResult<FlowErrorGroup[]>;
    }

    const groupBy = options.groupBy ?? 'errorCode';
    const groups = new Map<
      string,
      FlowErrorGroup & {
        durationValues: number[];
      }
    >();

    for (const run of runs.data ?? []) {
      const group = resolveFlowErrorGroup(run, flow.data, groupBy);
      const existing = groups.get(group);

      if (existing) {
        existing.count += 1;
        existing.totalRetries += run.retryCount ?? 0;
        existing.maxRetryCount = Math.max(existing.maxRetryCount, run.retryCount ?? 0);
        if (isDefinedNumber(run.durationMs)) {
          existing.durationValues.push(run.durationMs);
        }

        if ((run.startTime ?? '') > (existing.latestStartTime ?? '')) {
          existing.latestRunId = run.id;
          existing.latestStatus = run.status;
          existing.latestStartTime = run.startTime;
          existing.sampleErrorCode = run.errorCode;
          existing.sampleErrorMessage = run.errorMessage;
        }
        continue;
      }

      groups.set(group, {
        group,
        count: 1,
        latestRunId: run.id,
        latestStatus: run.status,
        latestStartTime: run.startTime,
        sampleErrorCode: run.errorCode,
        sampleErrorMessage: run.errorMessage,
        averageDurationMs: run.durationMs,
        totalRetries: run.retryCount ?? 0,
        maxRetryCount: run.retryCount ?? 0,
        durationValues: isDefinedNumber(run.durationMs) ? [run.durationMs] : [],
      });
    }

    return ok(
      Array.from(groups.values())
        .map(({ durationValues, ...group }) => ({
          ...group,
          averageDurationMs: averageIntegers(durationValues),
        }))
        .sort((left, right) => right.count - left.count || left.group.localeCompare(right.group)),
      {
        supportTier: 'experimental',
        diagnostics: runs.diagnostics,
        warnings: runs.warnings,
        knownLimitations: runs.knownLimitations,
      }
    );
  }

  async connrefs(
    identifier: string,
    options: {
      solutionUniqueName?: string;
      since?: string;
    } = {}
  ): Promise<OperationResult<FlowConnectionHealthReport | undefined>> {
    if (!this.dataverseClient) {
      return fail(
        createDiagnostic('error', 'FLOW_DATAVERSE_CLIENT_REQUIRED', 'Dataverse client is required for flow connection-health inspection.', {
          source: '@pp/flow',
        })
      );
    }

    const [flow, runs, references, variables] = await Promise.all([
      this.inspect(identifier, options),
      this.runs(identifier, {
        solutionUniqueName: options.solutionUniqueName,
        status: 'Failed',
        since: options.since,
      }),
      new ConnectionReferenceService(this.dataverseClient).validate({
        solutionUniqueName: options.solutionUniqueName,
      }),
      new EnvironmentVariableService(this.dataverseClient).list({
        solutionUniqueName: options.solutionUniqueName,
      }),
    ]);

    if (!flow.success) {
      return flow as unknown as OperationResult<FlowConnectionHealthReport | undefined>;
    }

    if (!runs.success) {
      return runs as unknown as OperationResult<FlowConnectionHealthReport | undefined>;
    }

    if (!references.success) {
      return references as unknown as OperationResult<FlowConnectionHealthReport | undefined>;
    }

    if (!variables.success) {
      return variables as unknown as OperationResult<FlowConnectionHealthReport | undefined>;
    }

    if (!flow.data) {
      return ok(undefined, {
        supportTier: 'experimental',
        diagnostics: flow.diagnostics,
        warnings: [...flow.warnings, ...runs.warnings, ...references.warnings, ...variables.warnings],
      });
    }

    const failedRuns = runs.data ?? [];
    const sourceCorrelation = buildFlowSourceCorrelationModel(flow.data);

    return ok(
      {
        flow: flow.data,
        sourceDefinition: sourceCorrelation
          ? {
              available: true,
              artifactName: sourceCorrelation.artifactName,
              nodeCount: sourceCorrelation.graph.summary.nodeCount,
              unresolvedEdgeCount: sourceCorrelation.graph.summary.unresolvedEdgeCount,
            }
          : {
              available: false,
            },
        connectionReferences: flow.data.connectionReferences.map((reference) => {
          const validation =
            (references.data ?? []).find((candidate) =>
              candidate.reference.logicalName === reference.connectionReferenceLogicalName ||
              candidate.reference.logicalName === reference.name
            ) ?? null;

          return {
            name: reference.name,
            valid: validation ? validation.valid && validation.diagnostics.length === 0 : false,
            diagnostics: (validation?.diagnostics ?? []).map((diagnostic) => diagnostic.message),
            recentFailures: countRunsForReference(failedRuns, reference.name),
            sourceNodes: sourceCorrelation?.connectionReferenceNodes.get(reference.name) ?? [],
          };
        }),
        environmentVariables: flow.data.environmentVariables.map((name) => {
          const variable = (variables.data ?? []).find((candidate) => candidate.schemaName === name);

          return {
            name,
            hasValue: Boolean(variable?.effectiveValue),
            recentFailures: failedRuns.length,
            sourceNodes: sourceCorrelation?.environmentVariableNodes.get(name) ?? [],
          };
        }),
      },
      {
        supportTier: 'experimental',
        diagnostics: [...flow.diagnostics, ...runs.diagnostics, ...references.diagnostics, ...variables.diagnostics],
        warnings: [...flow.warnings, ...runs.warnings, ...references.warnings, ...variables.warnings],
        knownLimitations: dedupeStrings([...(runs.knownLimitations ?? [])]),
      }
    );
  }

  async doctor(
    identifier: string,
    options: {
      solutionUniqueName?: string;
      since?: string;
    } = {}
  ): Promise<OperationResult<FlowDoctorReport>> {
    if (!this.dataverseClient) {
      return fail(
        createDiagnostic('error', 'FLOW_DATAVERSE_CLIENT_REQUIRED', 'Dataverse client is required for flow doctor reports.', {
          source: '@pp/flow',
        })
      );
    }

    const [flow, runs, errors, references, variables] = await Promise.all([
      this.inspect(identifier, options),
      this.runs(identifier, {
        solutionUniqueName: options.solutionUniqueName,
        since: options.since,
      }),
      this.errors(identifier, {
        solutionUniqueName: options.solutionUniqueName,
        since: options.since,
      }),
      new ConnectionReferenceService(this.dataverseClient).validate({
        solutionUniqueName: options.solutionUniqueName,
      }),
      new EnvironmentVariableService(this.dataverseClient).list({
        solutionUniqueName: options.solutionUniqueName,
      }),
    ]);

    if (!flow.success) {
      return flow as unknown as OperationResult<FlowDoctorReport>;
    }

    if (!runs.success) {
      return runs as unknown as OperationResult<FlowDoctorReport>;
    }

    if (!errors.success) {
      return errors as unknown as OperationResult<FlowDoctorReport>;
    }

    if (!references.success) {
      return references as unknown as OperationResult<FlowDoctorReport>;
    }

    if (!variables.success) {
      return variables as unknown as OperationResult<FlowDoctorReport>;
    }

    const failedRuns = (runs.data ?? []).filter((run) => normalizeStatus(run.status) === 'failed');
    const runtimeSummary = summarizeFlowRuns(runs.data ?? []);
    const invalidConnectionReferences = (references.data ?? []).filter((reference) =>
      flow.data?.connectionReferences.some(
        (flowReference) =>
          reference.reference.logicalName === flowReference.connectionReferenceLogicalName ||
          reference.reference.logicalName === flowReference.name
      )
    ).filter((reference) => !reference.valid || reference.diagnostics.length > 0);
    const missingEnvironmentVariables = (variables.data ?? []).filter(
      (variable) => flow.data?.environmentVariables.includes(variable.schemaName ?? '') && !variable.effectiveValue
    );
    const sourceCorrelation = flow.data ? buildFlowSourceCorrelationModel(flow.data) : undefined;
    const correlatedErrorGroups =
      flow.data && sourceCorrelation ? correlateFlowErrorGroups(errors.data ?? [], flow.data, sourceCorrelation) : [];
    const failureRate =
      runtimeSummary.statusCounts.reduce((total, entry) => total + entry.count, 0) > 0
        ? `${((failedRuns.length / Math.max(runs.data?.length ?? 0, 1)) * 100).toFixed(1)}%`
        : undefined;
    const findings = [
      ...buildQuietRuntimeBlockerFindings(flow.data, runs.data ?? [], invalidConnectionReferences),
      ...(failureRate
        ? [`${failedRuns.length} of ${runs.data?.length ?? 0} recent runs failed (${failureRate}).`]
        : []),
      ...(runtimeSummary.retry.totalRetries > 0
        ? [`Recent runs retried ${runtimeSummary.retry.totalRetries} time(s); max retry count was ${runtimeSummary.retry.maxRetryCount}.`]
        : []),
      ...(runtimeSummary.durationMs.p95 !== undefined
        ? [`Recent run duration p95 is ${runtimeSummary.durationMs.p95} ms.`]
        : []),
      ...invalidConnectionReferences.map(
        (reference) => `Connection reference ${reference.reference.logicalName ?? reference.reference.id} is invalid for this flow.`
      ),
      ...missingEnvironmentVariables.map(
        (variable) => `Environment variable ${variable.schemaName ?? variable.definitionId} does not have an effective value.`
      ),
      ...correlatedErrorGroups.map((group) => {
        const nodeNames = group.sourceNodes.map((node) => node.name).join(', ');
        return `Recent failures mention connection reference ${group.relatedConnectionReferences.join(', ')}, used by ${nodeNames}.`;
      }),
      ...(errors.data ?? []).slice(0, 3).map((group) => `Recent failures are grouping under ${group.group}.`),
    ];

    return ok(
      {
        flow: flow.data,
        recentRuns: {
          total: runs.data?.length ?? 0,
          failed: failedRuns.length,
          latestFailure: failedRuns[0],
        },
        runtimeSummary,
        errorGroups: errors.data ?? [],
        invalidConnectionReferences,
        missingEnvironmentVariables,
        sourceCorrelation: flow.data
          ? {
              available: Boolean(sourceCorrelation),
              artifactName: sourceCorrelation?.artifactName,
              summary: sourceCorrelation
                ? {
                    nodeCount: sourceCorrelation.graph.summary.nodeCount,
                    unresolvedEdgeCount: sourceCorrelation.graph.summary.unresolvedEdgeCount,
                    connectionReferenceCount: flow.data.connectionReferences.length,
                    environmentVariableCount: flow.data.environmentVariables.length,
                    errorGroupCount: correlatedErrorGroups.length,
                  }
                : undefined,
              connectionReferences: flow.data.connectionReferences.map((reference) => ({
                name: reference.name,
                recentFailures: countRunsForReference(failedRuns, reference.name),
                sourceNodes: sourceCorrelation?.connectionReferenceNodes.get(reference.name) ?? [],
              })),
              environmentVariables: flow.data.environmentVariables.map((name) => {
                const variable = (variables.data ?? []).find((candidate) => candidate.schemaName === name);

                return {
                  name,
                  hasValue: Boolean(variable?.effectiveValue),
                  recentFailures: failedRuns.length,
                  sourceNodes: sourceCorrelation?.environmentVariableNodes.get(name) ?? [],
                };
              }),
              errorGroups: correlatedErrorGroups,
            }
          : undefined,
        findings,
      },
      {
        supportTier: 'experimental',
        diagnostics: [...flow.diagnostics, ...runs.diagnostics, ...errors.diagnostics, ...references.diagnostics, ...variables.diagnostics],
        warnings: [...flow.warnings, ...runs.warnings, ...errors.warnings, ...references.warnings, ...variables.warnings],
        suggestedNextActions: dedupeStrings(
          [
            invalidConnectionReferences.length > 0
              ? `Run \`pp connref validate --environment <alias>${options.solutionUniqueName ? ` --solution ${options.solutionUniqueName}` : ''} --format json\` to inspect the failing connection references directly.`
              : undefined,
            ...invalidConnectionReferences.flatMap((reference) => {
              const logicalName = reference.reference.logicalName ?? reference.reference.id;
              if (!logicalName) {
                return [];
              }

              return [
                `Inspect the failing binding with \`pp connref inspect ${logicalName} --environment <alias>${options.solutionUniqueName ? ` --solution ${options.solutionUniqueName}` : ''} --format json\`.`,
                `Repair the binding with \`pp connref set ${logicalName} --environment <alias>${options.solutionUniqueName ? ` --solution ${options.solutionUniqueName}` : ''} --connection-id <connection-id> --format json\` once the target connection is known.`,
              ];
            }),
            missingEnvironmentVariables.length > 0
              ? `Run \`pp envvar list --environment <alias>${options.solutionUniqueName ? ` --solution ${options.solutionUniqueName}` : ''} --format json\` to inspect missing effective environment-variable values.`
              : undefined,
            flow.data?.workflowState === 'draft'
              ? `After repairing dependency blockers, re-enable the workflow with \`pp flow activate ${identifier} --environment <alias>${options.solutionUniqueName ? ` --solution ${options.solutionUniqueName}` : ''} --format json\`.`
              : undefined,
            failedRuns.length > 0
              ? `Run \`pp flow runs ${identifier} --environment <alias>${options.solutionUniqueName ? ` --solution ${options.solutionUniqueName}` : ''} --status Failed --format json\` to review the raw failed-run slice.`
              : undefined,
            `Run \`pp flow inspect ${identifier} --environment <alias>${options.solutionUniqueName ? ` --solution ${options.solutionUniqueName}` : ''} --format json\` to confirm the resolved workflow metadata and attached connection references.`,
          ].filter((value): value is string => Boolean(value))
        ),
        knownLimitations: [
          ...(runs.knownLimitations ?? []),
          'Runtime diagnostics depend on FlowRun ingestion and may lag behind portal data.',
          'Connector-level grouping is heuristic until richer runtime fields are available.',
        ],
        provenance: [
          {
            kind: 'official-api',
            source: 'Dataverse workflows',
          },
          {
            kind: 'official-api',
            source: 'Dataverse FlowRun history',
          },
          {
            kind: 'inferred',
            source: '@pp/flow source correlation',
            detail: 'Connection-reference and environment-variable source correlation is inferred from the exported workflow definition graph.',
          },
        ],
      }
    );
  }

  async monitor(
    identifier: string,
    options: {
      solutionUniqueName?: string;
      since?: string;
      baseline?: FlowMonitorReport;
    } = {}
  ): Promise<OperationResult<FlowMonitorReport>> {
    const doctor = await this.doctor(identifier, options);

    if (!doctor.success || !doctor.data) {
      return doctor as unknown as OperationResult<FlowMonitorReport>;
    }

    const latestRunAt = resolveLatestFlowRunTimestamp(doctor.data.runtimeSummary, doctor.data.recentRuns.latestFailure);
    const health = summarizeFlowMonitoringHealth(doctor.data, latestRunAt);
    const report: FlowMonitorReport = {
      checkedAt: new Date().toISOString(),
      observationWindow: options.since,
      flow: doctor.data.flow,
      health,
      recentRuns: doctor.data.recentRuns,
      runtimeSummary: doctor.data.runtimeSummary,
      errorGroups: doctor.data.errorGroups,
      invalidConnectionReferences: doctor.data.invalidConnectionReferences,
      missingEnvironmentVariables: doctor.data.missingEnvironmentVariables,
      findings: [],
    };
    const comparison = options.baseline ? compareFlowMonitorReports(options.baseline, report) : undefined;
    const findings = dedupeStrings([
      health.summary,
      ...(doctor.data.recentRuns.total === 0 && health.telemetryState === 'quiet'
        ? [
            'No recent runs or grouped errors were returned in the requested window, so follow-up monitoring is relying on static dependency health rather than fresh execution telemetry.',
          ]
        : []),
      ...(comparison?.findings ?? []),
      ...doctor.data.findings,
    ]);

    report.comparison = comparison;
    report.findings = findings;

    return ok(
      report,
      {
        supportTier: doctor.supportTier,
        diagnostics: doctor.diagnostics,
        warnings: doctor.warnings,
        suggestedNextActions: dedupeStrings([
          ...(doctor.suggestedNextActions ?? []),
          ...(options.baseline
            ? [
                'Persist this monitor payload and pass it back through `pp flow monitor --baseline <file>` when you want the next follow-up to report runtime deltas instead of manual JSON diffing.',
              ]
            : []),
          ...(doctor.data.recentRuns?.total === 0
            ? [
                `Re-run \`pp flow monitor ${identifier} --environment <alias>${options.solutionUniqueName ? ` --solution ${options.solutionUniqueName}` : ''} --since ${options.since ?? '1h'} --format json\` after the next expected trigger window to confirm whether runtime telemetry stays quiet.`,
              ]
            : []),
        ]),
        knownLimitations: dedupeStrings([
          ...(doctor.knownLimitations ?? []),
          'Monitoring summaries only reflect the requested lookback window; use repeated polls when you need a longer trend line.',
        ]),
        provenance: doctor.provenance,
      }
    );
  }

  async loadArtifact(path: string): Promise<OperationResult<FlowArtifact>> {
    return loadFlowArtifact(path);
  }

  async inspectArtifact(path: string): Promise<OperationResult<FlowArtifactSummary>> {
    return inspectFlowArtifact(path);
  }

  async parseArtifact(path: string): Promise<OperationResult<FlowIntermediateRepresentation>> {
    return parseFlowIntermediateRepresentation(path);
  }

  async graphArtifact(path: string): Promise<OperationResult<FlowGraphReport>> {
    return graphFlowArtifact(path);
  }

  async unpack(inputPath: string, outPath: string): Promise<OperationResult<FlowUnpackResult>> {
    return unpackFlowArtifact(inputPath, outPath);
  }

  async pack(path: string, outPath: string): Promise<OperationResult<FlowPackResult>> {
    return packFlowArtifact(path, outPath);
  }

  async exportArtifact(
    identifier: string,
    outPath: string,
    options: { solutionUniqueName?: string } = {}
  ): Promise<OperationResult<FlowExportResult>> {
    return exportRemoteFlowArtifact(identifier, outPath, {
      ...options,
      dataverseClient: this.dataverseClient,
    });
  }

  async deployArtifact(path: string, options: FlowDeployOptions = {}): Promise<OperationResult<FlowDeployResult>> {
    return deployFlowArtifact(path, {
      ...options,
      dataverseClient: this.dataverseClient,
    });
  }

  async promoteArtifact(identifier: string, options: FlowPromoteOptions = {}): Promise<OperationResult<FlowPromoteResult>> {
    return promoteRemoteFlowArtifact(identifier, {
      ...options,
      sourceDataverseClient: this.dataverseClient,
    });
  }

  async activate(identifier: string, options: { solutionUniqueName?: string } = {}): Promise<OperationResult<FlowPromoteResult>> {
    return activateRemoteFlow(identifier, {
      ...options,
      dataverseClient: this.dataverseClient,
    });
  }

  async normalize(path: string, outPath?: string): Promise<OperationResult<FlowUnpackResult>> {
    return normalizeFlowArtifact(path, outPath);
  }

  async validate(path: string): Promise<OperationResult<FlowValidationReport>> {
    return validateFlowArtifact(path);
  }

  async patch(path: string, patch: FlowPatchDocument, outPath?: string): Promise<OperationResult<FlowPatchResult>> {
    return patchFlowArtifact(path, patch, outPath);
  }
}

function moveFlowRunSchemaWarningToKnownLimitations(warnings: Diagnostic[]): { warnings: Diagnostic[]; knownLimitations: string[] } {
  const remainingWarnings: Diagnostic[] = [];
  const knownLimitations: string[] = [];

  for (const warning of warnings) {
    if (warning.code !== 'DATAVERSE_FLOWRUN_OPTIONAL_COLUMNS_UNAVAILABLE') {
      remainingWarnings.push(warning);
      continue;
    }

    knownLimitations.push(
      'This environment omits optional flowrun columns such as workflowname, durationinms, or retrycount; pp retried without them so runtime evidence may omit workflow names, durations, or retry counts.'
    );
  }

  return {
    warnings: remainingWarnings,
    knownLimitations: dedupeStrings(knownLimitations),
  };
}

function buildQuietRuntimeBlockerFindings(
  flow: FlowInspectResult | undefined,
  runs: FlowRunSummary[],
  invalidConnectionReferences: ConnectionReferenceValidationResult[]
): string[] {
  if (!flow || runs.length > 0) {
    return [];
  }

  if (flow.workflowState !== 'draft' && flow.workflowState !== 'suspended') {
    return [];
  }

  if (invalidConnectionReferences.length === 0) {
    return [];
  }

  const names = invalidConnectionReferences
    .map((reference) => reference.reference.logicalName ?? reference.reference.displayName ?? reference.reference.id)
    .filter((value): value is string => Boolean(value));

  if (names.length === 0) {
    return [];
  }

  const label = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
  return [
    `No recent flow runs were returned because the flow is still ${flow.workflowState} and connection reference ${label} is not runnable yet.`,
  ];
}

export async function loadFlowArtifact(path: string): Promise<OperationResult<FlowArtifact>> {
  const resolvedPath = await resolveFlowArtifactPath(path);

  if (!resolvedPath.success || !resolvedPath.data) {
    return resolvedPath as unknown as OperationResult<FlowArtifact>;
  }

  const document = await readFlowJsonFile(resolvedPath.data);

  if (!document.success || document.data === undefined) {
    return document as unknown as OperationResult<FlowArtifact>;
  }

  return normalizeFlowArtifactDocument(document.data, resolvedPath.data);
}

export async function inspectFlowArtifact(path: string): Promise<OperationResult<FlowArtifactSummary>> {
  const artifact = await loadFlowArtifact(path);

  if (!artifact.success || !artifact.data) {
    return artifact as unknown as OperationResult<FlowArtifactSummary>;
  }

  return ok(buildFlowArtifactSummary(path, artifact.data), {
    supportTier: 'preview',
    diagnostics: artifact.diagnostics,
    warnings: artifact.warnings,
  });
}

export async function unpackFlowArtifact(inputPath: string, outPath: string): Promise<OperationResult<FlowUnpackResult>> {
  const artifact = await loadFlowArtifact(inputPath);

  if (!artifact.success || !artifact.data) {
    return artifact as unknown as OperationResult<FlowUnpackResult>;
  }

  const destination = resolveFlowOutputPath(outPath);
  await writeJsonFile(destination, artifact.data as unknown as Parameters<typeof writeJsonFile>[1]);

  return ok(
    {
      inputPath,
      outPath: destination,
      summary: buildFlowArtifactSummary(destination, artifact.data),
    },
    {
      supportTier: 'preview',
      diagnostics: artifact.diagnostics,
      warnings: artifact.warnings,
    }
  );
}

export async function deployFlowArtifact(
  path: string,
  options: FlowDeployOptions & { dataverseClient?: DataverseClient } = {}
): Promise<OperationResult<FlowDeployResult>> {
  if (!options.dataverseClient) {
    return fail(
      createDiagnostic('error', 'FLOW_DATAVERSE_CLIENT_REQUIRED', 'Dataverse client is required for remote flow deploy.', {
        source: '@pp/flow',
      })
    );
  }

  const artifact = await loadFlowArtifact(path);

  if (!artifact.success || !artifact.data) {
    return artifact as unknown as OperationResult<FlowDeployResult>;
  }

  const deployArtifact = applyFlowWorkflowStateOverride(artifact.data, options.workflowState);
  const validation = validateLoadedFlowArtifact(path, deployArtifact, {
    diagnostics: artifact.diagnostics,
    warnings: artifact.warnings,
  });

  if (!validation.data) {
    return validation as unknown as OperationResult<FlowDeployResult>;
  }

  if (!validation.data.valid) {
    return fail(
      [
        ...artifact.diagnostics,
        ...validation.diagnostics,
        createDiagnostic(
          'error',
          'FLOW_DEPLOY_VALIDATION_FAILED',
          `Flow artifact ${path} failed local validation and was not deployed.`,
          {
            source: '@pp/flow',
            path,
          }
        ),
      ],
      {
        supportTier: 'preview',
        warnings: [...artifact.warnings, ...validation.warnings],
      }
    );
  }

  return deployLoadedFlowArtifact(path, deployArtifact, validation, {
    dataverseClient: options.dataverseClient,
    solutionUniqueName: options.solutionUniqueName,
    target: options.target,
    createIfMissing: options.createIfMissing,
    workflowState: options.workflowState,
    diagnostics: artifact.diagnostics,
    warnings: artifact.warnings,
  });
}

export async function promoteRemoteFlowArtifact(
  identifier: string,
  options: FlowPromoteOptions & {
    sourceDataverseClient?: DataverseClient;
  } = {}
): Promise<OperationResult<FlowPromoteResult>> {
  if (!options.solutionPackage && hasFlowSolutionPackageImportOverrides(options)) {
    return fail(
      createDiagnostic(
        'error',
        'FLOW_PROMOTE_PACKAGE_IMPORT_OPTIONS_UNSUPPORTED',
        'Solution import override flags require --solution-package on flow promote.',
        {
          source: '@pp/flow',
        }
      )
    );
  }

  if (!options.sourceDataverseClient) {
    return fail(
      createDiagnostic('error', 'FLOW_DATAVERSE_CLIENT_REQUIRED', 'Dataverse client is required for remote flow promotion source inspection.', {
        source: '@pp/flow',
      })
    );
  }

  if (!options.targetDataverseClient) {
    return fail(
      createDiagnostic('error', 'FLOW_DATAVERSE_CLIENT_REQUIRED', 'Dataverse client is required for remote flow promotion target deploy.', {
        source: '@pp/flow',
      })
    );
  }

  const sourceFlow = await new FlowService(options.sourceDataverseClient).inspect(identifier, {
    solutionUniqueName: options.sourceSolutionUniqueName,
  });

  if (!sourceFlow.success) {
    return sourceFlow as unknown as OperationResult<FlowPromoteResult>;
  }

  if (!sourceFlow.data) {
    return fail(
      [
        ...sourceFlow.diagnostics,
        createDiagnostic('error', 'FLOW_PROMOTE_SOURCE_NOT_FOUND', `Source flow ${identifier} was not found.`, {
          source: '@pp/flow',
        }),
      ],
      {
        supportTier: 'preview',
        warnings: sourceFlow.warnings,
      }
    );
  }

  if (options.solutionPackage && options.workflowState) {
    return fail(
      [
        ...sourceFlow.diagnostics,
        createDiagnostic(
          'error',
          'FLOW_PROMOTE_PACKAGE_WORKFLOW_STATE_UNSUPPORTED',
          'Solution-package flow promotion imports the packaged workflow state as-is and does not support --workflow-state.',
          {
            source: '@pp/flow',
          }
        ),
      ],
      {
        supportTier: 'preview',
        warnings: sourceFlow.warnings,
      }
    );
  }

  const artifact = buildFlowArtifactFromRemoteFlow(sourceFlow.data);

  if (!artifact.success || !artifact.data) {
    return fail([...sourceFlow.diagnostics, ...artifact.diagnostics], {
      supportTier: 'preview',
      warnings: [...sourceFlow.warnings, ...artifact.warnings],
    });
  }

  const sourcePath = artifact.data.metadata.sourcePath ?? `dataverse://workflows/${sourceFlow.data.id}`;
  const promotedArtifact = applyFlowWorkflowStateOverride(artifact.data, options.workflowState);
  const validation = validateLoadedFlowArtifact(sourcePath, promotedArtifact, {
    diagnostics: [...sourceFlow.diagnostics, ...artifact.diagnostics],
    warnings: [...sourceFlow.warnings, ...artifact.warnings],
  });

  if (!validation.success || !validation.data) {
    return validation as unknown as OperationResult<FlowPromoteResult>;
  }

  if (!validation.data.valid) {
    return fail(
      [
        ...validation.diagnostics,
        createDiagnostic('error', 'FLOW_PROMOTE_VALIDATION_FAILED', `Source flow ${identifier} failed local validation and was not promoted.`, {
          source: '@pp/flow',
          path: sourcePath,
        }),
      ],
      {
        supportTier: 'preview',
        warnings: validation.warnings,
      }
    );
  }

  if (options.solutionPackage) {
    return promoteRemoteFlowArtifactAsSolutionPackage(identifier, sourceFlow.data, promotedArtifact, validation, options);
  }

  const deployed = await deployLoadedFlowArtifact(sourcePath, promotedArtifact, validation, {
    dataverseClient: options.targetDataverseClient,
    solutionUniqueName: options.targetSolutionUniqueName,
    target: options.target,
    createIfMissing: options.createIfMissing,
    workflowState: options.workflowState,
    diagnostics: [...sourceFlow.diagnostics, ...artifact.diagnostics],
    warnings: [...sourceFlow.warnings, ...artifact.warnings],
  });

  if (!deployed.success || !deployed.data) {
    return deployed as unknown as OperationResult<FlowPromoteResult>;
  }

  return ok(
    {
      identifier,
      source: {
        id: sourceFlow.data.id,
        name: sourceFlow.data.name,
        description: sourceFlow.data.description,
        uniqueName: sourceFlow.data.uniqueName,
        category: sourceFlow.data.category,
        workflowMetadata: sourceFlow.data.workflowMetadata,
        workflowState: sourceFlow.data.workflowState,
        stateCode: sourceFlow.data.stateCode,
        statusCode: sourceFlow.data.statusCode,
        solutionUniqueName: options.sourceSolutionUniqueName,
      },
      targetIdentifier: deployed.data.targetIdentifier,
      operation: deployed.data.operation,
      target: deployed.data.target,
      summary: deployed.data.summary,
      validation: deployed.data.validation,
      promotionMode: 'artifact',
    },
    {
      supportTier: 'preview',
      diagnostics: deployed.diagnostics,
      warnings: deployed.warnings,
      knownLimitations: [
        ...(deployed.knownLimitations ?? []),
        'Remote flow promotion currently transfers only a bounded workflow shell (`name`, `description`, `category`, `type`, `mode`, `ondemand`, `primaryentity`, `statecode`, `statuscode`) plus the normalized clientdata payload.',
      ],
      provenance: [
        {
          kind: 'official-api',
          source: 'Dataverse workflows GET/PATCH/POST',
        },
      ],
    }
  );
}

export async function activateRemoteFlow(
  identifier: string,
  options: {
    dataverseClient?: DataverseClient;
    solutionUniqueName?: string;
  } = {}
): Promise<OperationResult<FlowPromoteResult>> {
  if (!options.dataverseClient) {
    return fail(
      createDiagnostic('error', 'FLOW_DATAVERSE_CLIENT_REQUIRED', 'Dataverse client is required for remote flow activation.', {
        source: '@pp/flow',
      })
    );
  }

  const sourceFlow = await new FlowService(options.dataverseClient).inspect(identifier, {
    solutionUniqueName: options.solutionUniqueName,
  });

  if (!sourceFlow.success) {
    return sourceFlow as unknown as OperationResult<FlowPromoteResult>;
  }

  if (!sourceFlow.data) {
    return fail(
      [
        ...sourceFlow.diagnostics,
        createDiagnostic('error', 'FLOW_PROMOTE_SOURCE_NOT_FOUND', `Source flow ${identifier} was not found.`, {
          source: '@pp/flow',
        }),
      ],
      {
        supportTier: 'preview',
        warnings: sourceFlow.warnings,
      }
    );
  }

  const artifact = buildFlowArtifactFromRemoteFlow(sourceFlow.data);

  if (!artifact.success || !artifact.data) {
    return fail([...sourceFlow.diagnostics, ...artifact.diagnostics], {
      supportTier: 'preview',
      warnings: [...sourceFlow.warnings, ...artifact.warnings],
    });
  }

  const sourcePath = artifact.data.metadata.sourcePath ?? `dataverse://workflows/${sourceFlow.data.id}`;
  const activatedArtifact = applyFlowWorkflowStateOverride(artifact.data, 'activated');
  const validation = validateLoadedFlowArtifact(sourcePath, activatedArtifact, {
    diagnostics: [...sourceFlow.diagnostics, ...artifact.diagnostics],
    warnings: [...sourceFlow.warnings, ...artifact.warnings],
  });

  if (!validation.success || !validation.data) {
    return validation as unknown as OperationResult<FlowPromoteResult>;
  }

  if (!validation.data.valid) {
    return fail(
      [
        ...validation.diagnostics,
        createDiagnostic('error', 'FLOW_DEPLOY_VALIDATION_FAILED', `Flow ${identifier} failed local validation and was not activated.`, {
          source: '@pp/flow',
          path: sourcePath,
        }),
      ],
      {
        supportTier: 'preview',
        warnings: validation.warnings,
      }
    );
  }

  const activationUpdate = await applyFlowActivationUpdateWithFallbacks(sourceFlow.data.id, activatedArtifact, options.dataverseClient);
  const attemptedActivationPayloads = activationUpdate.attemptedPayloads;
  const update = activationUpdate.result;

  if (!update.success) {
    const activationFailure = detectInPlaceActivationFailure(update.diagnostics, {
      identifier: sourceFlow.data.uniqueName ?? sourceFlow.data.name ?? sourceFlow.data.id,
      solutionUniqueName: options.solutionUniqueName,
      workflowCategory: sourceFlow.data.category,
      workflowState: sourceFlow.data.workflowState,
    });
    const activationFailureDetails = activationFailure
      ? await collectFlowActivationFailureDetails(sourceFlow.data, options.dataverseClient, options.solutionUniqueName)
      : undefined;
    const splitUpdateDiagnostics = splitWarningDiagnostics(update.diagnostics);
    return fail(
      [...validation.diagnostics, ...splitUpdateDiagnostics.diagnostics, ...(activationFailure?.diagnostics ?? [])],
      {
        details: {
          ...(activationFailureDetails ?? {}),
          activationAttempts: attemptedActivationPayloads,
        },
        supportTier: 'preview',
        warnings: [...validation.warnings, ...splitUpdateDiagnostics.warnings, ...update.warnings],
        suggestedNextActions: activationFailure?.suggestedNextActions,
        knownLimitations: dedupeStrings([
          ...(activationFailure?.knownLimitations ?? []),
          attemptedActivationPayloads.length > 1
            ? `pp already retried activation with ${attemptedActivationPayloads.join(', ')} payload strategies for this workflow before surfacing the remaining Dataverse limitation.`
            : '',
        ]),
        provenance: [
          {
            kind: 'official-api',
            source: 'Dataverse workflows PATCH',
          },
        ],
      }
    );
  }

  return ok(
    {
      identifier,
      source: {
        id: sourceFlow.data.id,
        name: sourceFlow.data.name,
        description: sourceFlow.data.description,
        uniqueName: sourceFlow.data.uniqueName,
        category: sourceFlow.data.category,
        workflowMetadata: sourceFlow.data.workflowMetadata,
        workflowState: sourceFlow.data.workflowState,
        stateCode: sourceFlow.data.stateCode,
        statusCode: sourceFlow.data.statusCode,
        solutionUniqueName: options.solutionUniqueName,
      },
      targetIdentifier: identifier,
      operation: 'updated',
      target: {
        id: sourceFlow.data.id,
        name: activatedArtifact.metadata.displayName ?? activatedArtifact.metadata.name ?? sourceFlow.data.name,
        description: activatedArtifact.metadata.description ?? sourceFlow.data.description,
        uniqueName: activatedArtifact.metadata.uniqueName ?? sourceFlow.data.uniqueName,
        category: resolveSupportedFlowWorkflowCategory(activatedArtifact.metadata.category ?? sourceFlow.data.category).category,
        workflowMetadata: resolveSupportedFlowWorkflowShellMetadata(
          activatedArtifact.metadata.workflowMetadata ?? sourceFlow.data.workflowMetadata
        ).workflowMetadata,
        ...resolveFlowResultWorkflowState(activatedArtifact.metadata.stateCode, activatedArtifact.metadata.statusCode),
        solutionUniqueName: options.solutionUniqueName,
      },
      summary: buildFlowArtifactSummary(sourcePath, activatedArtifact),
      validation: {
        valid: true,
        warningCount: validation.warnings.length,
      },
      promotionMode: 'artifact',
    },
    {
      supportTier: 'preview',
      diagnostics: [...validation.diagnostics, ...update.diagnostics],
      warnings: [...validation.warnings, ...update.warnings],
      knownLimitations: [
        'In-place activation resolves the workflow through the requested solution scope when provided, then patches the Dataverse workflow record directly without re-attaching it to that solution during the same write.',
      ],
      provenance: [
        {
          kind: 'official-api',
          source: 'Dataverse workflows GET/PATCH',
        },
      ],
    }
  );
}

async function promoteRemoteFlowArtifactAsSolutionPackage(
  identifier: string,
  sourceFlow: FlowInspectResult,
  artifact: FlowArtifact,
  validation: OperationResult<FlowValidationReport>,
  options: FlowPromoteOptions & {
    sourceDataverseClient?: DataverseClient;
  }
): Promise<OperationResult<FlowPromoteResult>> {
  if (!options.sourceDataverseClient || !options.targetDataverseClient || !validation.data) {
    return fail(
      createDiagnostic('error', 'FLOW_DATAVERSE_CLIENT_REQUIRED', 'Dataverse clients are required for solution-package flow promotion.', {
        source: '@pp/flow',
      })
    );
  }

  if (!options.sourceSolutionUniqueName) {
    return fail(
      [
        ...validation.diagnostics,
        createDiagnostic(
          'error',
          'FLOW_PROMOTE_PACKAGE_SOURCE_SOLUTION_REQUIRED',
          'Solution-package flow promotion requires --source-solution so the containing solution can be exported.',
          {
            source: '@pp/flow',
          }
        ),
      ],
      {
        supportTier: 'preview',
        warnings: validation.warnings,
      }
    );
  }

  if (options.target) {
    return fail(
      [
        ...validation.diagnostics,
        createDiagnostic(
          'error',
          'FLOW_PROMOTE_PACKAGE_TARGET_UNSUPPORTED',
          'Solution-package flow promotion imports the selected solution as-is and does not support --target.',
          {
            source: '@pp/flow',
          }
        ),
      ],
      {
        supportTier: 'preview',
        warnings: validation.warnings,
      }
    );
  }

  if (options.createIfMissing) {
    return fail(
      [
        ...validation.diagnostics,
        createDiagnostic(
          'error',
          'FLOW_PROMOTE_PACKAGE_CREATE_UNSUPPORTED',
          'Solution-package flow promotion imports the selected solution as-is and does not support --create-if-missing.',
          {
            source: '@pp/flow',
          }
        ),
      ],
      {
        supportTier: 'preview',
        warnings: validation.warnings,
      }
    );
  }

  if (
    options.targetSolutionUniqueName &&
    options.targetSolutionUniqueName.trim().toLowerCase() !== options.sourceSolutionUniqueName.trim().toLowerCase()
  ) {
    return fail(
      [
        ...validation.diagnostics,
        createDiagnostic(
          'error',
          'FLOW_PROMOTE_PACKAGE_TARGET_SOLUTION_RENAME_UNSUPPORTED',
          `Solution-package flow promotion cannot rename solution ${options.sourceSolutionUniqueName} to ${options.targetSolutionUniqueName}; import preserves the packaged solution unique name.`,
          {
            source: '@pp/flow',
          }
        ),
      ],
      {
        supportTier: 'preview',
        warnings: validation.warnings,
      }
    );
  }

  const packageType = options.solutionPackageManaged ? 'managed' : 'unmanaged';
  const importOptions = {
    publishWorkflows: options.publishWorkflows ?? true,
    overwriteUnmanagedCustomizations: options.overwriteUnmanagedCustomizations ?? false,
    holdingSolution: options.holdingSolution ?? false,
    skipProductUpdateDependencies: options.skipProductUpdateDependencies ?? false,
    importJobId: options.importJobId,
  };
  const tempRoot = await mkdtemp(join(tmpdir(), 'pp-flow-promote-solution-'));

  try {
    const sourceSolutionService = new SolutionService(options.sourceDataverseClient);
    const targetSolutionService = new SolutionService(options.targetDataverseClient);
    const packagePath = join(tempRoot, `${options.sourceSolutionUniqueName}_${packageType}.zip`);
    const exportResult = await sourceSolutionService.exportSolution(options.sourceSolutionUniqueName, {
      managed: options.solutionPackageManaged,
      outPath: packagePath,
    });

    if (!exportResult.success || !exportResult.data) {
      return fail([...validation.diagnostics, ...exportResult.diagnostics], {
        supportTier: 'preview',
        warnings: [...validation.warnings, ...exportResult.warnings],
        provenance: exportResult.provenance,
      });
    }

    const importResult = await targetSolutionService.importSolution(exportResult.data.artifact.path, importOptions);

    if (!importResult.success || !importResult.data) {
      return fail([...validation.diagnostics, ...exportResult.diagnostics, ...importResult.diagnostics], {
        supportTier: 'preview',
        warnings: [...validation.warnings, ...exportResult.warnings, ...importResult.warnings],
        provenance: [
          ...(exportResult.provenance ?? []),
          ...(importResult.provenance ?? []),
        ],
      });
    }

    return ok(
      {
        identifier,
        source: {
          id: sourceFlow.id,
          name: sourceFlow.name,
          description: sourceFlow.description,
          uniqueName: sourceFlow.uniqueName,
          category: sourceFlow.category,
          workflowMetadata: sourceFlow.workflowMetadata,
          workflowState: sourceFlow.workflowState,
          stateCode: sourceFlow.stateCode,
          statusCode: sourceFlow.statusCode,
          solutionUniqueName: options.sourceSolutionUniqueName,
        },
        operation: 'imported-solution',
        promotionMode: 'solution-package',
        targetSolutionUniqueName: options.sourceSolutionUniqueName,
        solutionPackage: {
          packageType,
        },
        importOptions,
        summary: buildFlowArtifactSummary(artifact.metadata.sourcePath ?? `dataverse://workflows/${sourceFlow.id}`, artifact),
        validation: {
          valid: true,
          warningCount: validation.warnings.length,
        },
      },
      {
        supportTier: 'preview',
        diagnostics: [...validation.diagnostics, ...exportResult.diagnostics, ...importResult.diagnostics],
        warnings: [...validation.warnings, ...exportResult.warnings, ...importResult.warnings],
        knownLimitations: [
          'Solution-package flow promotion imports the whole selected solution that contains the flow, not just the selected workflow row.',
          'Solution-package flow promotion preserves the packaged solution unique name and does not support --target or --create-if-missing.',
        ],
        provenance: [
          ...(exportResult.provenance ?? []),
          ...(importResult.provenance ?? []),
        ],
      }
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export async function normalizeFlowArtifact(path: string, outPath?: string): Promise<OperationResult<FlowUnpackResult>> {
  const artifact = await loadFlowArtifact(path);

  if (!artifact.success || !artifact.data) {
    return artifact as unknown as OperationResult<FlowUnpackResult>;
  }

  const destination = resolveFlowOutputPath(outPath ?? path);
  await writeJsonFile(destination, artifact.data as unknown as Parameters<typeof writeJsonFile>[1]);

  return ok(
    {
      inputPath: path,
      outPath: destination,
      summary: buildFlowArtifactSummary(destination, artifact.data),
    },
    {
      supportTier: 'preview',
      diagnostics: artifact.diagnostics,
      warnings: artifact.warnings,
    }
  );
}

export async function packFlowArtifact(path: string, outPath: string): Promise<OperationResult<FlowPackResult>> {
  const artifact = await loadFlowArtifact(path);

  if (!artifact.success || !artifact.data) {
    return artifact as unknown as OperationResult<FlowPackResult>;
  }

  const destination = resolve(outPath);
  await mkdir(dirname(destination), { recursive: true });
  await writeJsonFile(destination, buildRawFlowArtifactDocument(artifact.data) as unknown as Parameters<typeof writeJsonFile>[1]);

  return ok(
    {
      path,
      outPath: destination,
      format: 'raw-json',
      summary: buildFlowArtifactSummary(destination, artifact.data),
    },
    {
      supportTier: 'preview',
      diagnostics: artifact.diagnostics,
      warnings: artifact.warnings,
    }
  );
}

export async function exportRemoteFlowArtifact(
  identifier: string,
  outPath: string,
  options: {
    solutionUniqueName?: string;
    dataverseClient?: DataverseClient;
  } = {}
): Promise<OperationResult<FlowExportResult>> {
  if (!options.dataverseClient) {
    return fail(
      createDiagnostic('error', 'FLOW_DATAVERSE_CLIENT_REQUIRED', 'Dataverse client is required for remote flow export.', {
        source: '@pp/flow',
      })
    );
  }

  const flow = await new FlowService(options.dataverseClient).inspect(identifier, {
    solutionUniqueName: options.solutionUniqueName,
  });

  if (!flow.success) {
    return flow as unknown as OperationResult<FlowExportResult>;
  }

  if (!flow.data) {
    return fail(
      [
        ...flow.diagnostics,
        createDiagnostic('error', 'FLOW_NOT_FOUND', `Flow ${identifier} was not found.`, {
          source: '@pp/flow',
        }),
      ],
      {
        supportTier: 'preview',
        warnings: flow.warnings,
      }
    );
  }

  const artifact = buildFlowArtifactFromRemoteFlow(flow.data);

  if (!artifact.success || !artifact.data) {
    return fail(artifact.diagnostics, {
      supportTier: 'preview',
      warnings: artifact.warnings,
    });
  }

  const destination = resolveFlowOutputPath(outPath);
  await mkdir(dirname(destination), { recursive: true });
  await writeJsonFile(destination, artifact.data as unknown as Parameters<typeof writeJsonFile>[1]);

  return ok(
    {
      identifier,
      outPath: destination,
      source: {
        id: flow.data.id,
        name: flow.data.name,
        description: flow.data.description,
        uniqueName: flow.data.uniqueName,
        category: flow.data.category,
        workflowMetadata: flow.data.workflowMetadata,
        workflowState: flow.data.workflowState,
        stateCode: flow.data.stateCode,
        statusCode: flow.data.statusCode,
        solutionUniqueName: options.solutionUniqueName,
      },
      summary: buildFlowArtifactSummary(destination, artifact.data),
    },
    {
      supportTier: 'preview',
      diagnostics: flow.diagnostics,
      warnings: [...flow.warnings, ...artifact.warnings],
      provenance: [
        {
          kind: 'official-api',
          source: 'Dataverse workflows GET',
        },
      ],
    }
  );
}

async function deployLoadedFlowArtifact(
  path: string,
  artifact: FlowArtifact,
  validation: OperationResult<FlowValidationReport>,
  options: {
    dataverseClient?: DataverseClient;
    solutionUniqueName?: string;
    target?: string;
    createIfMissing?: boolean;
    workflowState?: FlowWorkflowStateLabel;
    diagnostics?: Diagnostic[];
    warnings?: Diagnostic[];
  }
): Promise<OperationResult<FlowDeployResult>> {
  if (!options.dataverseClient || !validation.data) {
    return fail(
      createDiagnostic('error', 'FLOW_DATAVERSE_CLIENT_REQUIRED', 'Dataverse client is required for remote flow deploy.', {
        source: '@pp/flow',
      })
    );
  }

  let diagnostics = [...(options.diagnostics ?? []), ...validation.diagnostics];
  let warnings = [...(options.warnings ?? []), ...validation.warnings];
  const targetIdentifier = resolveFlowDeployTargetIdentifier(artifact, options.target);
  const createIdentifier = resolveFlowCreateIdentifier(artifact);

  if (!targetIdentifier) {
    return fail(
      [
        ...diagnostics,
        createDiagnostic(
          'error',
          'FLOW_DEPLOY_TARGET_REQUIRED',
          `Flow artifact ${path} does not declare a targetable id, name, or unique name; pass --target to deploy it.`,
          {
            source: '@pp/flow',
            path,
          }
        ),
      ],
      {
        supportTier: 'preview',
        warnings,
      }
    );
  }

  if (options.createIfMissing) {
    const targetMismatch = resolveFlowCreateTargetMismatch(artifact, options.target);

    if (targetMismatch) {
      return fail(
        [
          ...diagnostics,
          createDiagnostic(
            'error',
            'FLOW_DEPLOY_CREATE_TARGET_MISMATCH',
            `Flow artifact ${path} cannot create a missing target for ${options.target} because the artifact metadata does not match that identifier.`,
            {
              source: '@pp/flow',
              path,
            }
          ),
        ],
        {
          supportTier: 'preview',
          warnings,
        }
      );
    }

    if (!createIdentifier) {
      return fail(
        [
          ...diagnostics,
          createDiagnostic(
            'error',
            'FLOW_DEPLOY_CREATE_UNIQUE_NAME_REQUIRED',
            `Flow artifact ${path} must declare metadata.uniqueName before create-if-missing can provision a remote flow.`,
            {
              source: '@pp/flow',
              path,
            }
          ),
        ],
        {
          supportTier: 'preview',
          warnings,
        }
      );
    }
  }

  const remoteTargetValidation = await validateFlowArtifactRemoteTargets(path, artifact, {
    dataverseClient: options.dataverseClient,
    solutionUniqueName: options.solutionUniqueName,
  });

  diagnostics = [...diagnostics, ...remoteTargetValidation.diagnostics];
  warnings = [...warnings, ...remoteTargetValidation.warnings];

  if (!remoteTargetValidation.success) {
    return fail(diagnostics, {
      supportTier: 'preview',
      warnings,
      provenance: [
        {
          kind: 'official-api',
          source: 'Dataverse solutions/connectionreferences/environmentvariabledefinitions GET',
        },
      ],
    });
  }

  const flowService = new FlowService(options.dataverseClient);
  const remoteFlow = await flowService.inspect(targetIdentifier, {
    solutionUniqueName: options.solutionUniqueName,
  });

  if (!remoteFlow.success) {
    return remoteFlow as unknown as OperationResult<FlowDeployResult>;
  }

  if (!remoteFlow.data) {
    if (options.createIfMissing && createIdentifier) {
      const globalFlow = await flowService.inspect(createIdentifier);

      if (!globalFlow.success) {
        return globalFlow as unknown as OperationResult<FlowDeployResult>;
      }

      if (globalFlow.data) {
        return fail(
          [
            ...diagnostics,
            ...remoteFlow.diagnostics,
            ...globalFlow.diagnostics,
            createDiagnostic(
              'error',
              'FLOW_DEPLOY_TARGET_EXISTS_OUTSIDE_SOLUTION',
              `Flow ${createIdentifier} already exists in the target environment but was not resolved inside solution ${options.solutionUniqueName ?? '(none)'}.`,
              {
                source: '@pp/flow',
                path,
                hint: `Attach the existing workflow with \`pp flow attach ${createIdentifier} --environment <alias> --solution ${options.solutionUniqueName ?? '<solution>'} --format json\`, or choose a new unique name if you want a solution-scoped copy instead.`,
              }
            ),
          ],
          {
            supportTier: 'preview',
            warnings: [...warnings, ...remoteFlow.warnings, ...globalFlow.warnings],
            suggestedNextActions: dedupeStrings([
              `Run \`pp flow attach ${createIdentifier} --environment <alias> --solution ${options.solutionUniqueName ?? '<solution>'} --format json\` to package the existing workflow into the solution.`,
              `Use a different metadata.uniqueName if you want \`pp flow deploy --create-if-missing\` to create a separate solution-scoped copy instead.`,
            ]),
          }
        );
      }

      const createEntity = buildFlowDeployCreateEntity(artifact);
      const create = await options.dataverseClient.create<Record<string, unknown>, FlowRecord>(
        'workflows',
        createEntity,
        options.solutionUniqueName
          ? {
              returnRepresentation: true,
              solutionUniqueName: options.solutionUniqueName,
            }
          : {
              returnRepresentation: true,
            }
      );

      if (!create.success) {
        return fail([...diagnostics, ...remoteFlow.diagnostics, ...globalFlow.diagnostics, ...create.diagnostics], {
          supportTier: 'preview',
          warnings: [...warnings, ...remoteFlow.warnings, ...globalFlow.warnings, ...create.warnings],
          provenance: [
            {
              kind: 'official-api',
              source: 'Dataverse workflows POST',
            },
          ],
        });
      }

      const createdTarget = {
        id: create.data?.entity?.workflowid ?? create.data?.entityId ?? '',
        name: create.data?.entity?.name ?? artifact.metadata.displayName ?? artifact.metadata.name ?? createIdentifier,
        description: readString(create.data?.entity?.description) ?? artifact.metadata.description,
        uniqueName: create.data?.entity?.uniquename ?? createIdentifier,
        category: readNumber(create.data?.entity?.category) ?? resolveSupportedFlowWorkflowCategory(artifact.metadata.category).category,
        workflowMetadata:
          normalizeFlowWorkflowShellMetadata({
            type: create.data?.entity?.type,
            mode: create.data?.entity?.mode,
            onDemand: create.data?.entity?.ondemand,
            primaryEntity: create.data?.entity?.primaryentity,
          }) ?? resolveSupportedFlowWorkflowShellMetadata(artifact.metadata.workflowMetadata).workflowMetadata,
        ...resolveFlowResultWorkflowState(
          readNumber(create.data?.entity?.statecode) ?? artifact.metadata.stateCode,
          readNumber(create.data?.entity?.statuscode) ?? artifact.metadata.statusCode
        ),
        solutionUniqueName: options.solutionUniqueName,
      };

      return ok(
        {
          path,
          targetIdentifier: createIdentifier,
          operation: 'created',
          target: createdTarget,
          updatedFields: Object.keys(createEntity),
          summary: buildFlowArtifactSummary(path, artifact),
          validation: {
            valid: true,
            warningCount: validation.warnings.length,
          },
        },
        buildFlowDeploySuccessMetadata(
          {
            targetIdentifier: createIdentifier,
            target: createdTarget,
          },
          {
          supportTier: 'preview',
          diagnostics: [...diagnostics, ...remoteFlow.diagnostics, ...globalFlow.diagnostics, ...create.diagnostics],
          warnings: [...warnings, ...remoteFlow.warnings, ...globalFlow.warnings, ...create.warnings],
          knownLimitations: [
            'Create-if-missing provisions only a bounded workflow shell with normalized clientdata and bounded workflow metadata.',
            'Flow creation does not yet cover broader workflow metadata/state transitions beyond the bounded shell or solution-packaged import/export workflows.',
          ],
          provenance: [
            {
              kind: 'official-api',
              source: 'Dataverse workflows POST',
            },
          ],
          }
        )
      );
    }

    return fail(
      [
        ...diagnostics,
        ...remoteFlow.diagnostics,
        createDiagnostic('error', 'FLOW_DEPLOY_TARGET_NOT_FOUND', `Flow ${targetIdentifier} was not found in the target environment.`, {
          source: '@pp/flow',
          path,
        }),
      ],
      {
        supportTier: 'preview',
        warnings: [...warnings, ...remoteFlow.warnings],
      }
    );
  }

  const uniqueNameMismatch = resolveFlowTargetUniqueNameMismatch(artifact, remoteFlow.data);

  if (uniqueNameMismatch) {
    return fail(
      [
        ...diagnostics,
        ...remoteFlow.diagnostics,
        createDiagnostic(
          'error',
          'FLOW_DEPLOY_TARGET_UNIQUE_NAME_MISMATCH',
          `Flow artifact ${path} declares uniqueName ${uniqueNameMismatch.artifactUniqueName}, but the resolved target workflow uses ${uniqueNameMismatch.remoteUniqueName}.`,
          {
            source: '@pp/flow',
            path,
            hint: 'Existing-target deploy and artifact-mode promotion currently require metadata.uniqueName to match the resolved remote workflow identity.',
          }
        ),
      ],
      {
        supportTier: 'preview',
        warnings: [...warnings, ...remoteFlow.warnings],
      }
    );
  }

  const updateEntity = buildFlowDeployUpdateEntity(artifact);
  const updateOptions = options.solutionUniqueName
    ? {
        solutionUniqueName: options.solutionUniqueName,
      }
    : {};
  let update = await options.dataverseClient.update('workflows', remoteFlow.data.id, updateEntity, updateOptions);
  let attemptedActivationPayloads: string[] = [];

  if (
    !update.success &&
    resolveSupportedFlowWorkflowState(artifact.metadata.stateCode, artifact.metadata.statusCode).stateCode ===
      FLOW_WORKFLOW_STATE_LABEL_STATE.get('activated')
  ) {
    const activationUpdate = await applyFlowActivationUpdateWithFallbacks(remoteFlow.data.id, artifact, options.dataverseClient, updateOptions, {
      initialAttempt: {
        payload: 'normalized-clientdata',
        result: update,
      },
    });
    attemptedActivationPayloads = activationUpdate.attemptedPayloads;
    update = activationUpdate.result;
  }

  if (!update.success) {
    const activationFailure = detectInPlaceActivationFailure(update.diagnostics, {
      identifier: remoteFlow.data.uniqueName ?? remoteFlow.data.name ?? remoteFlow.data.id,
      solutionUniqueName: options.solutionUniqueName,
      workflowCategory: remoteFlow.data.category,
      workflowState: remoteFlow.data.workflowState,
    });
    const activationFailureDetails = activationFailure
      ? await collectFlowActivationFailureDetails(remoteFlow.data, options.dataverseClient, options.solutionUniqueName)
      : undefined;
    const splitUpdateDiagnostics = splitWarningDiagnostics(update.diagnostics);
    return fail(
      [...diagnostics, ...remoteFlow.diagnostics, ...splitUpdateDiagnostics.diagnostics, ...(activationFailure?.diagnostics ?? [])],
      {
        ...(activationFailureDetails || attemptedActivationPayloads.length > 0
          ? {
              details: {
                ...(activationFailureDetails ?? {}),
                ...(attemptedActivationPayloads.length > 0 ? { activationAttempts: attemptedActivationPayloads } : {}),
              },
            }
          : {}),
        supportTier: 'preview',
        warnings: [...warnings, ...remoteFlow.warnings, ...splitUpdateDiagnostics.warnings, ...update.warnings],
        suggestedNextActions: activationFailure?.suggestedNextActions,
        knownLimitations: dedupeStrings([
          ...(activationFailure?.knownLimitations ?? []),
          attemptedActivationPayloads.length > 1
            ? `pp already retried activation with ${attemptedActivationPayloads.join(', ')} payload strategies for this workflow before surfacing the remaining Dataverse limitation.`
            : '',
        ]),
        provenance: [
          {
            kind: 'official-api',
            source: 'Dataverse workflows PATCH',
          },
        ],
      }
    );
  }

  const updatedTarget = {
    id: remoteFlow.data.id,
    name: artifact.metadata.displayName ?? artifact.metadata.name ?? remoteFlow.data.name,
    description: artifact.metadata.description ?? remoteFlow.data.description,
    uniqueName: artifact.metadata.uniqueName ?? remoteFlow.data.uniqueName,
    category: resolveSupportedFlowWorkflowCategory(artifact.metadata.category ?? remoteFlow.data.category).category,
    workflowMetadata: resolveSupportedFlowWorkflowShellMetadata(
      artifact.metadata.workflowMetadata ?? remoteFlow.data.workflowMetadata
    ).workflowMetadata,
    ...resolveFlowResultWorkflowState(artifact.metadata.stateCode ?? remoteFlow.data.stateCode, artifact.metadata.statusCode ?? remoteFlow.data.statusCode),
    solutionUniqueName: options.solutionUniqueName,
  };

  return ok(
    {
      path,
      targetIdentifier,
      operation: 'updated',
      target: updatedTarget,
      updatedFields: Object.keys(updateEntity),
      summary: buildFlowArtifactSummary(path, artifact),
      validation: {
        valid: true,
        warningCount: validation.warnings.length,
      },
    },
    buildFlowDeploySuccessMetadata(
      {
        targetIdentifier,
        target: updatedTarget,
      },
      {
      supportTier: 'preview',
      diagnostics: [...diagnostics, ...remoteFlow.diagnostics, ...update.diagnostics],
      warnings: [...warnings, ...remoteFlow.warnings, ...update.warnings],
      knownLimitations: [
        'Remote flow deploy currently syncs only a bounded workflow shell (`name`, `description`, `category`, `type`, `mode`, `ondemand`, `primaryentity`, `statecode`, `statuscode`) plus the normalized clientdata payload.',
        'Flow creation, solution import/export packaging, and broader workflow metadata/state transitions beyond that bounded shell still require later lifecycle work.',
      ],
      provenance: [
        {
          kind: 'official-api',
          source: 'Dataverse workflows PATCH',
        },
      ],
      }
    )
  );
}

async function collectFlowActivationFailureDetails(
  flow: FlowInspectResult,
  dataverseClient: DataverseClient,
  solutionUniqueName?: string
): Promise<FlowActivationFailureDetails> {
  const details: FlowActivationFailureDetails = {
    flow: {
      id: flow.id,
      name: flow.name,
      uniqueName: flow.uniqueName,
      category: flow.category,
      workflowState: flow.workflowState,
      solutionUniqueName,
      definitionAvailable: flow.definitionAvailable,
      connectionReferences: flow.connectionReferences.map(
        (reference) =>
          reference.connectionReferenceLogicalName ?? reference.name ?? reference.connectionId ?? reference.apiId ?? '(unknown)'
      ),
      parameters: flow.parameters,
      environmentVariables: flow.environmentVariables,
    },
  };

  if (!solutionUniqueName) {
    return details;
  }

  const syncStatus = await new SolutionService(dataverseClient).syncStatus(solutionUniqueName, {
    includeExportCheck: true,
  });

  if (!syncStatus.success || !syncStatus.data) {
    return {
      ...details,
      solutionSyncStatusFailure: {
        diagnostics: syncStatus.diagnostics,
        warnings: syncStatus.warnings,
        suggestedNextActions: syncStatus.suggestedNextActions,
      },
    };
  }

  return {
    ...details,
    solutionSyncStatus: {
      synchronization: syncStatus.data.synchronization,
      blockers: syncStatus.data.blockers,
      readBack: {
        summary: syncStatus.data.readBack.summary,
        workflows: syncStatus.data.readBack.workflows,
      },
      exportCheck: syncStatus.data.exportCheck,
    },
  };
}

function splitWarningDiagnostics(diagnostics: Diagnostic[] | undefined): {
  diagnostics: Diagnostic[];
  warnings: Diagnostic[];
} {
  const items = diagnostics ?? [];
  return {
    diagnostics: items.filter((diagnostic) => diagnostic.level !== 'warning'),
    warnings: items.filter((diagnostic) => diagnostic.level === 'warning'),
  };
}

function detectInPlaceActivationFailure(
  diagnostics: Diagnostic[],
  context: {
    identifier: string;
    solutionUniqueName?: string;
    workflowCategory?: number;
    workflowState?: FlowWorkflowStateLabel;
  }
): 
  | {
      diagnostics: Diagnostic[];
      suggestedNextActions: string[];
      knownLimitations: string[];
    }
  | undefined {
  const blocking = diagnostics.find((diagnostic) => {
    if (diagnostic.code !== 'HTTP_REQUEST_FAILED' || !/\breturned 400\b/.test(diagnostic.message)) {
      return false;
    }

    if (isDefinitionPayloadActivationFailure(diagnostic.detail)) {
      return true;
    }

    const detail = parseDataverseErrorDetail(diagnostic.detail);
    return (
      isDefinitionPayloadActivationFailureCodeOrMessage(detail?.code, detail?.message) ||
      detail?.code === 'DefinitionRequestUnsupportedSchemaVersion'
    );
  });

  if (!blocking) {
    return undefined;
  }

  const activationTarget = context.identifier;
  const activateCommand = `pp flow activate ${activationTarget} --environment <alias>${context.solutionUniqueName ? ` --solution ${context.solutionUniqueName}` : ''} --format json`;
  return {
    diagnostics: [
      createDiagnostic(
        'error',
        isUnsupportedSchemaVersionActivationFailure(blocking.detail)
          ? 'FLOW_ACTIVATE_UNSUPPORTED_SCHEMA_VERSION'
          : 'FLOW_ACTIVATE_DEFINITION_REQUIRED',
        isUnsupportedSchemaVersionActivationFailure(blocking.detail)
          ? `Flow ${activationTarget} could not be updated in place because Dataverse rejected the workflow definition schema version carried by the current clientdata payload.`
          : `Flow ${activationTarget} could not be activated in place because Dataverse requires a full flow definition payload for this workflow update path.`,
        {
          source: '@pp/flow',
          hint: isUnsupportedSchemaVersionActivationFailure(blocking.detail)
            ? `Capture the current blocker with \`pp flow inspect ${activationTarget} --environment <alias>${context.solutionUniqueName ? ` --solution ${context.solutionUniqueName}` : ''} --format json\`; if the flow is still draft with \`definitionAvailable=true\`, create a solution-scoped copy or attach the existing workflow instead of retrying the same PATCH path.`
            : `Capture the current blocker with \`pp flow inspect ${activationTarget} --environment <alias>${context.solutionUniqueName ? ` --solution ${context.solutionUniqueName}` : ''} --format json\`; if that inspect still reports \`definitionAvailable=true\`, the remaining limitation is the Dataverse activation endpoint rather than missing flow metadata in pp.`,
        }
      ),
    ],
    suggestedNextActions: dedupeStrings([
      `Run \`pp flow inspect ${activationTarget} --environment <alias>${context.solutionUniqueName ? ` --solution ${context.solutionUniqueName}` : ''} --format json\` to capture the current workflow state and identifiers.`,
      context.solutionUniqueName
        ? `If the flow already exists outside the solution, run \`pp flow attach ${activationTarget} --environment <alias> --solution ${context.solutionUniqueName} --format json\` before retrying packaging work.`
        : `If packaging is the goal, create a solution-scoped copy instead of retrying the same in-place PATCH path.`,
      context.solutionUniqueName
        ? `Run \`pp solution sync-status ${context.solutionUniqueName} --environment <alias> --format json\` to confirm whether this draft workflow is still blocking solution export readiness.`
        : `Inspect the parent solution packaging state before retrying activation if this workflow is meant to unblock a solution export.`,
    ]),
    knownLimitations: dedupeStrings([
      context.workflowCategory === 5
        ? 'In-place activation for some Dataverse Modern Flow records is not yet supported through the current workflows PATCH path because the platform expects a full definition payload.'
        : 'In-place activation can fail when the Dataverse workflows PATCH path requires fields that pp does not currently round-trip.',
      isUnsupportedSchemaVersionActivationFailure(blocking.detail)
        ? 'Dataverse can reject modern-flow updates when workflows.clientdata carries a schema version the workflows PATCH endpoint will not accept; in those cases pp should prefer attach/copy workflows over repeated in-place update retries.'
        : undefined,
      `When Dataverse rejects the activation payload because the flow definition shape is incompatible with the workflows PATCH path, repeating \`${activateCommand}\` without changing the activation path is unlikely to succeed.`,
      context.workflowCategory === 5
        ? 'If `pp flow activate` and `pp flow deploy --workflow-state activated` both hit `FLOW_ACTIVATE_DEFINITION_REQUIRED`, pp does not currently have another native activation path for that draft modern flow.'
        : undefined,
    ]),
  };
}

function isUnsupportedSchemaVersionActivationFailure(detail: string | undefined): boolean {
  const parsed = parseDataverseErrorDetail(detail);
  return parsed?.code === 'DefinitionRequestUnsupportedSchemaVersion' || /unsupported schema version/i.test(parsed?.message ?? detail ?? '');
}

function isDefinitionPayloadActivationFailure(detail: string | undefined): boolean {
  if (!detail) {
    return false;
  }

  if (detail.includes('DefinitionRequestMissingFields')) {
    return true;
  }

  return /unexpected 'StartObject' node .* property named 'definition'/i.test(detail);
}

function shouldRetryFlowActivationStateOnly(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => {
    if (diagnostic.code !== 'HTTP_REQUEST_FAILED') {
      return false;
    }

    const parsed = parseDataverseErrorDetail(diagnostic.detail);
    return isDefinitionPayloadActivationFailureCodeOrMessage(parsed?.code, parsed?.message ?? diagnostic.detail ?? '');
  });
}

async function applyFlowActivationUpdateWithFallbacks(
  workflowId: string,
  artifact: FlowArtifact,
  dataverseClient: DataverseClient,
  updateOptions: { solutionUniqueName?: string } = {},
  options: {
    initialAttempt?: {
      payload: string;
      result: OperationResult<{
        status: number;
        headers: Record<string, string>;
      }>;
    };
  } = {}
): Promise<{
  attemptedPayloads: string[];
  result: OperationResult<{
    status: number;
    headers: Record<string, string>;
  }>;
}> {
  const attemptedPayloads = options.initialAttempt ? [options.initialAttempt.payload] : ['normalized-clientdata'];
  let update =
    options.initialAttempt?.result ??
    (await dataverseClient.update('workflows', workflowId, buildFlowActivationUpdateEntity(artifact), updateOptions));

  if (!update.success && shouldRetryFlowActivationWithTopLevelDefinition(update.diagnostics)) {
    attemptedPayloads.push('clientdata-with-top-level-definition');
    update = await dataverseClient.update(
      'workflows',
      workflowId,
      buildFlowActivationTopLevelDefinitionUpdateEntity(artifact),
      updateOptions
    );
  }

  if (!update.success && shouldRetryFlowActivationStateOnly(update.diagnostics)) {
    attemptedPayloads.push('state-only');
    update = await dataverseClient.update('workflows', workflowId, buildFlowActivationStateOnlyUpdateEntity(artifact), updateOptions);
  }

  if (!update.success && shouldRetryFlowActivationStateCodeOnly(update.diagnostics, artifact)) {
    attemptedPayloads.push('statecode-only');
    update = await dataverseClient.update('workflows', workflowId, buildFlowActivationStateCodeOnlyUpdateEntity(artifact), updateOptions);
  }

  return {
    attemptedPayloads,
    result: update,
  };
}

function shouldRetryFlowActivationWithTopLevelDefinition(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => {
    if (diagnostic.code !== 'HTTP_REQUEST_FAILED') {
      return false;
    }

    const parsed = parseDataverseErrorDetail(diagnostic.detail);
    return parsed?.code === 'DefinitionRequestMissingFields' || /required field 'definition'/i.test(parsed?.message ?? '');
  });
}

function shouldRetryFlowActivationStateCodeOnly(diagnostics: Diagnostic[], artifact: FlowArtifact): boolean {
  const workflowState = resolveSupportedFlowWorkflowState(artifact.metadata.stateCode, artifact.metadata.statusCode);
  if (workflowState.stateCode === undefined || workflowState.statusCode === undefined) {
    return false;
  }

  return diagnostics.some((diagnostic) => diagnostic.code === 'HTTP_REQUEST_FAILED' && /\breturned 400\b/.test(diagnostic.message));
}

function isDefinitionPayloadActivationFailureCodeOrMessage(code: string | undefined, message: string | undefined): boolean {
  if (code === 'DefinitionRequestMissingFields') {
    return true;
  }

  if (!message) {
    return false;
  }

  return /required field 'definition'/i.test(message) || /unexpected 'StartObject' node .* property named 'definition'/i.test(message);
}

function parseDataverseErrorDetail(detail: string | undefined): { code?: string; message?: string } | undefined {
  if (!detail) {
    return undefined;
  }

  const parseCandidate = (value: string): { code?: string; message?: string } | undefined => {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      const nestedError =
        parsed.error && typeof parsed.error === 'object' && !Array.isArray(parsed.error)
          ? (parsed.error as Record<string, unknown>)
          : undefined;
      const code = readString(nestedError?.code) ?? readString(parsed.code);
      const message = readString(nestedError?.message) ?? readString(parsed.message);
      return code || message ? { code, message } : undefined;
    } catch {
      return undefined;
    }
  };

  const direct = parseCandidate(detail);
  if (direct?.code || direct?.message) {
    if (isDefinitionPayloadActivationFailureCodeOrMessage(direct.code, direct.message)) {
      return direct;
    }

    const nested = direct.message ? parseCandidate(direct.message) : undefined;
    if (nested?.code || nested?.message) {
      return nested;
    }

    const embeddedJson = direct.message?.match(/\{.*\}/s)?.[0];
    if (embeddedJson) {
      const embedded = parseCandidate(embeddedJson);
      if (embedded?.code || embedded?.message) {
        return embedded;
      }
    }

    return direct;
  }

  const embeddedJson = detail.match(/\{.*\}/s)?.[0];
  const embedded = embeddedJson ? parseCandidate(embeddedJson) : undefined;
  if (embedded?.code || embedded?.message) {
    return embedded;
  }

  if (isDefinitionPayloadActivationFailure(detail)) {
    const nestedMessageMatch = detail.match(
      /"message":"([^"]*DefinitionRequestMissingFields[^"]*)"|"message":"([^"]*required field[^"]*)"|"message":"([^"]*StartObject[^"]*property named 'definition'[^"]*)"/
    );
    return {
      code: 'DefinitionRequestMissingFields',
      message: nestedMessageMatch?.[3] ?? nestedMessageMatch?.[2] ?? nestedMessageMatch?.[1],
    };
  }

  return undefined;
}

async function validateFlowArtifactRemoteTargets(
  path: string,
  artifact: FlowArtifact,
  options: {
    dataverseClient?: DataverseClient;
    solutionUniqueName?: string;
  }
): Promise<OperationResult<{ checked: boolean }>> {
  if (!options.dataverseClient || !options.solutionUniqueName) {
    return ok(
      { checked: false },
      {
        supportTier: 'preview',
      }
    );
  }

  const solution = await new SolutionService(options.dataverseClient).inspect(options.solutionUniqueName);

  if (!solution.success) {
    return solution as unknown as OperationResult<{ checked: boolean }>;
  }

  if (!solution.data) {
    return fail(
      [
        ...solution.diagnostics,
        createDiagnostic(
          'error',
          'FLOW_DEPLOY_TARGET_SOLUTION_NOT_FOUND',
          `Target solution ${options.solutionUniqueName} was not found for flow artifact ${path}.`,
          {
            source: '@pp/flow',
            path,
          }
        ),
      ],
      {
        supportTier: 'preview',
        warnings: solution.warnings,
      }
    );
  }

  const [references, variables] = await Promise.all([
    new ConnectionReferenceService(options.dataverseClient).list({
      solutionUniqueName: options.solutionUniqueName,
    }),
    new EnvironmentVariableService(options.dataverseClient).list({
      solutionUniqueName: options.solutionUniqueName,
    }),
  ]);

  if (!references.success) {
    return fail([...solution.diagnostics, ...references.diagnostics], {
      supportTier: 'preview',
      warnings: [...solution.warnings, ...references.warnings],
    });
  }

  if (!variables.success) {
    return fail([...solution.diagnostics, ...variables.diagnostics], {
      supportTier: 'preview',
      warnings: [...solution.warnings, ...variables.warnings],
    });
  }

  const referenceByLogicalName = new Map(
    (references.data ?? [])
      .filter((reference) => reference.logicalName)
      .map((reference) => [reference.logicalName?.toLowerCase() ?? '', reference])
  );
  const variableBySchema = new Map(
    (variables.data ?? [])
      .filter((variable) => variable.schemaName)
      .map((variable) => [variable.schemaName?.toLowerCase() ?? '', variable])
  );
  const diagnostics: Diagnostic[] = [...solution.diagnostics, ...references.diagnostics, ...variables.diagnostics];
  const warnings: Diagnostic[] = [...solution.warnings, ...references.warnings, ...variables.warnings];

  for (const reference of artifact.metadata.connectionReferences) {
    const projectedLogicalName = reference.connectionReferenceLogicalName ?? reference.name;
    const discovered = referenceByLogicalName.get(projectedLogicalName.toLowerCase());

    if (!discovered) {
      diagnostics.push(
        createDiagnostic(
          'error',
          'FLOW_DEPLOY_TARGET_CONNREF_MISSING',
          `Flow artifact ${path} projects connection reference ${projectedLogicalName} but it was not found in solution ${options.solutionUniqueName}.`,
          {
            source: '@pp/flow',
            path,
          }
        )
      );
      continue;
    }

    if (!discovered.connected) {
      warnings.push(
        createDiagnostic(
          'warning',
          'FLOW_DEPLOY_TARGET_CONNREF_UNBOUND',
          `Flow artifact ${path} projects connection reference ${projectedLogicalName}, but the target reference is not connected in solution ${options.solutionUniqueName}.`,
          {
            source: '@pp/flow',
            path,
          }
        )
      );
    }
  }

  for (const variable of artifact.metadata.environmentVariables) {
    const discovered = variableBySchema.get(variable.toLowerCase());

    if (!discovered) {
      diagnostics.push(
        createDiagnostic(
          'error',
          'FLOW_DEPLOY_TARGET_ENVVAR_MISSING',
          `Flow artifact ${path} projects environment variable ${variable} but it was not found in solution ${options.solutionUniqueName}.`,
          {
            source: '@pp/flow',
            path,
          }
        )
      );
      continue;
    }

    if (!discovered.effectiveValue) {
      warnings.push(
        createDiagnostic(
          'warning',
          'FLOW_DEPLOY_TARGET_ENVVAR_VALUE_MISSING',
          `Flow artifact ${path} projects environment variable ${variable}, but the target variable does not have an effective value in solution ${options.solutionUniqueName}.`,
          {
            source: '@pp/flow',
            path,
          }
        )
      );
    }
  }

  if (diagnostics.some((diagnostic) => diagnostic.code.startsWith('FLOW_DEPLOY_TARGET_'))) {
    return fail(diagnostics, {
      supportTier: 'preview',
      warnings,
    });
  }

  return ok(
    {
      checked: true,
    },
    {
      supportTier: 'preview',
      diagnostics,
      warnings,
    }
  );
}

export async function validateFlowArtifact(path: string): Promise<OperationResult<FlowValidationReport>> {
  const artifact = await loadFlowArtifact(path);

  if (!artifact.success || !artifact.data) {
    return artifact as unknown as OperationResult<FlowValidationReport>;
  }

  return validateLoadedFlowArtifact(path, artifact.data, {
    diagnostics: artifact.diagnostics,
    warnings: artifact.warnings,
  });
}

function validateLoadedFlowArtifact(
  path: string,
  artifact: FlowArtifact,
  base: {
    diagnostics?: Diagnostic[];
    warnings?: Diagnostic[];
  } = {}
): OperationResult<FlowValidationReport> {
  const diagnostics = [...(base.diagnostics ?? [])];
  const warnings = [...(base.warnings ?? [])];
  const seenConnrefs = new Set<string>();

  if (!artifact.metadata.name && !artifact.metadata.displayName) {
    diagnostics.push(
      createDiagnostic('error', 'FLOW_ARTIFACT_NAME_MISSING', `Flow artifact ${path} does not define a name or displayName.`, {
        source: '@pp/flow',
      })
    );
  }

  if (Object.keys(artifact.definition).length === 0) {
    diagnostics.push(
      createDiagnostic('error', 'FLOW_DEFINITION_MISSING', `Flow artifact ${path} does not include a definition payload.`, {
        source: '@pp/flow',
      })
    );
  }

  diagnostics.push(...validateFlowClientDataDefinitionConsistency(artifact, path));
  diagnostics.push(...validateFlowWorkflowStateMetadata(artifact, path));
  diagnostics.push(...validateFlowWorkflowCategoryMetadata(artifact, path));
  diagnostics.push(...validateFlowWorkflowShellMetadata(artifact, path));

  const semantic = analyzeFlowSemantics(artifact, path);
  diagnostics.push(...semantic.diagnostics);
  warnings.push(...semantic.warnings);

  for (const reference of artifact.metadata.connectionReferences) {
    if (!reference.name) {
      diagnostics.push(
        createDiagnostic('error', 'FLOW_CONNREF_NAME_MISSING', `Flow artifact ${path} contains a connection reference with no name.`, {
          source: '@pp/flow',
        })
      );
      continue;
    }

    if (seenConnrefs.has(reference.name)) {
      diagnostics.push(
        createDiagnostic('error', 'FLOW_CONNREF_DUPLICATE', `Flow artifact ${path} contains duplicate connection reference ${reference.name}.`, {
          source: '@pp/flow',
        })
      );
    }

    seenConnrefs.add(reference.name);
  }

  return ok(
    {
      valid: diagnostics.length === 0,
      path,
      name: artifact.metadata.displayName ?? artifact.metadata.name,
      connectionReferences: artifact.metadata.connectionReferences,
      parameters: Object.keys(artifact.metadata.parameters).sort(),
      environmentVariables: artifact.metadata.environmentVariables,
      intermediateRepresentation: semantic.intermediateRepresentation,
      semanticSummary: semantic.summary,
    },
    {
      supportTier: 'preview',
      diagnostics,
      warnings,
    }
  );
}

export function validateFlowArtifactContent(
  path: string,
  content: unknown
): OperationResult<FlowValidationReport> {
  if (typeof content !== 'object' || content === null) {
    return fail(
      createDiagnostic('error', 'FLOW_ARTIFACT_INVALID', `Flow artifact at ${path} is not a valid JSON object.`, {
        source: '@pp/flow',
      })
    );
  }
  return validateLoadedFlowArtifact(path, content as FlowArtifact);
}

export function buildFlowIR(artifact: FlowArtifact): FlowIntermediateRepresentation {
  return buildFlowIntermediateRepresentation(artifact);
}

export async function parseFlowIntermediateRepresentation(
  path: string
): Promise<OperationResult<FlowIntermediateRepresentation>> {
  const artifact = await loadFlowArtifact(path);

  if (!artifact.success || !artifact.data) {
    return artifact as unknown as OperationResult<FlowIntermediateRepresentation>;
  }

  return ok(buildFlowIntermediateRepresentation(artifact.data), {
    supportTier: 'preview',
    diagnostics: artifact.diagnostics,
    warnings: artifact.warnings,
  });
}

export async function graphFlowArtifact(path: string): Promise<OperationResult<FlowGraphReport>> {
  const artifact = await loadFlowArtifact(path);

  if (!artifact.success || !artifact.data) {
    return artifact as unknown as OperationResult<FlowGraphReport>;
  }

  return ok(buildFlowGraphReport(artifact.data), {
    supportTier: 'preview',
    diagnostics: artifact.diagnostics,
    warnings: artifact.warnings,
  });
}

export async function patchFlowArtifact(
  path: string,
  patch: FlowPatchDocument,
  outPath?: string
): Promise<OperationResult<FlowPatchResult>> {
  const artifact = await loadFlowArtifact(path);

  if (!artifact.success || !artifact.data) {
    return artifact as unknown as OperationResult<FlowPatchResult>;
  }

  const actionRenameValidation = validateFlowActionRenamePatch(artifact.data, patch.actions ?? {});

  if (actionRenameValidation) {
    return fail(actionRenameValidation);
  }

  const connectionReferenceRenameValidation = validateFlowConnectionReferenceRenamePatch(
    artifact.data,
    patch.connectionReferences ?? {}
  );

  if (connectionReferenceRenameValidation) {
    return fail(connectionReferenceRenameValidation);
  }

  const environmentVariableRenameValidation = validateFlowEnvironmentVariableRenamePatch(
    artifact.data,
    patch.environmentVariables ?? {}
  );

  if (environmentVariableRenameValidation) {
    return fail(environmentVariableRenameValidation);
  }

  const variableRenameValidation = validateFlowVariableRenamePatch(artifact.data, patch.variables ?? {});

  if (variableRenameValidation) {
    return fail(variableRenameValidation);
  }

  const cloned = cloneJsonValue(artifact.data) as FlowArtifact;
  const appliedOperations: string[] = [];

  for (const [from, to] of Object.entries(patch.connectionReferences ?? {})) {
    renameConnectionReference(cloned, from, to);
    appliedOperations.push(`connectionReference:${from}->${to}`);
  }

  for (const [from, to] of Object.entries(patch.environmentVariables ?? {})) {
    renameEnvironmentVariable(cloned, from, to);
    appliedOperations.push(`environmentVariable:${from}->${to}`);
  }

  for (const [from, to] of Object.entries(patch.variables ?? {})) {
    if (from === to) {
      continue;
    }

    renameVariable(cloned, from, to);
    appliedOperations.push(`variable:${from}->${to}`);
  }

  for (const [name, value] of Object.entries(patch.parameters ?? {})) {
    cloned.metadata.parameters[name] = normalizeFlowJsonValue(value);
    setFlowPathValue(cloned.definition, ['parameters', name, 'defaultValue'], normalizeFlowJsonValue(value));
    appliedOperations.push(`parameter:${name}`);
  }

  for (const [pathExpression, expression] of Object.entries(patch.expressions ?? {})) {
    setFlowPathValue(cloned.definition, parseFlowPath(pathExpression), expression);
    appliedOperations.push(`expression:${pathExpression}`);
  }

  for (const [pathExpression, value] of Object.entries(patch.values ?? {})) {
    setFlowPathValue(cloned.definition, parseFlowPath(pathExpression), normalizeFlowJsonValue(value));
    appliedOperations.push(`value:${pathExpression}`);
  }

  for (const [from, to] of Object.entries(patch.actions ?? {})) {
    if (from === to) {
      continue;
    }

    renameAction(cloned, from, to);
    appliedOperations.push(`action:${from}->${to}`);
  }

  synchronizeFlowClientDataDefinition(cloned);

  const destination = resolveFlowOutputPath(outPath ?? path);
  await writeJsonFile(destination, cloned as unknown as Parameters<typeof writeJsonFile>[1]);

  return ok(
    {
      path,
      outPath: destination,
      changed: appliedOperations.length > 0,
      appliedOperations,
      summary: buildFlowArtifactSummary(destination, cloned),
    },
    {
      supportTier: 'preview',
      diagnostics: artifact.diagnostics,
      warnings: artifact.warnings,
    }
  );
}

function validateFlowClientDataDefinitionConsistency(artifact: FlowArtifact, path: string): Diagnostic[] {
  const clientData = artifact.clientData;

  if (!clientData) {
    return [];
  }

  const topLevelDefinition = asFlowJsonRecord(clientData.definition);
  const nestedDefinition = asFlowJsonRecord(asRecord(clientData.properties)?.definition);
  const diagnostics: Diagnostic[] = [];

  if (topLevelDefinition && !flowJsonValuesEqual(topLevelDefinition, artifact.definition)) {
    diagnostics.push(
      createDiagnostic(
        'error',
        'FLOW_CLIENTDATA_DEFINITION_MISMATCH',
        `Flow artifact ${path} has a stale clientData.definition payload that does not match definition.`,
        {
          source: '@pp/flow',
          hint: 'Re-run `pp flow patch` or `pp flow normalize` to resynchronize the preserved clientData definition copy.',
        }
      )
    );
  }

  if (nestedDefinition && !flowJsonValuesEqual(nestedDefinition, artifact.definition)) {
    diagnostics.push(
      createDiagnostic(
        'error',
        'FLOW_CLIENTDATA_PROPERTIES_DEFINITION_MISMATCH',
        `Flow artifact ${path} has a stale clientData.properties.definition payload that does not match definition.`,
        {
          source: '@pp/flow',
          hint: 'Re-run `pp flow patch` or `pp flow normalize` to resynchronize the preserved clientData definition copy.',
        }
      )
    );
  }

  return diagnostics;
}

function flowJsonValuesEqual(left: FlowJsonValue, right: FlowJsonValue): boolean {
  return stableStringify(left) === stableStringify(right);
}

function synchronizeFlowClientDataDefinition(artifact: FlowArtifact): void {
  if (!artifact.clientData) {
    return;
  }

  artifact.clientData.definition = cloneJsonValue(artifact.definition);

  const existingProperties = asRecord(artifact.clientData.properties);
  artifact.clientData.properties = {
    ...(existingProperties ? cloneJsonValue(existingProperties) : {}),
    definition: cloneJsonValue(artifact.definition),
  } as FlowJsonValue;
}

function normalizeRemoteFlow(record: DataverseCloudFlowInspectResult): FlowInspectResult {
  const workflowState = resolveFlowWorkflowStateLabel(record.stateCode, record.statusCode);

  return {
    id: record.id,
    name: record.name,
    description: record.description,
    uniqueName: record.uniqueName,
    category: record.category,
    workflowMetadata: normalizeFlowWorkflowShellMetadata({
      type: record.type,
      mode: record.mode,
      onDemand: record.onDemand,
      primaryEntity: record.primaryEntity,
    }),
    ...(workflowState ? { workflowState } : {}),
    stateCode: record.stateCode,
    statusCode: record.statusCode,
    definitionAvailable: record.definitionAvailable,
    connectionReferences: record.connectionReferences,
    parameters: record.parameters,
    environmentVariables: record.environmentVariables,
    clientData: asFlowJsonRecord(record.clientData),
  };
}

function extractRemoteFlowDefinition(clientData: Record<string, FlowJsonValue> | undefined): Record<string, FlowJsonValue> | undefined {
  return asFlowJsonRecord(clientData?.definition) ?? asFlowJsonRecord(asRecord(clientData?.properties)?.definition);
}

function buildFlowArtifactFromRemoteFlow(flow: FlowInspectResult): OperationResult<FlowArtifact> {
  const definition = extractRemoteFlowDefinition(flow.clientData);
  const workflowState = resolveSupportedFlowWorkflowState(flow.stateCode, flow.statusCode);
  const workflowMetadata = buildRawFlowWorkflowShellFields(flow.workflowMetadata);

  if (!definition) {
    const clientDataKeys = Object.keys(asRecord(flow.clientData) ?? {});
    const propertiesKeys = Object.keys(asRecord(asRecord(flow.clientData)?.properties) ?? {});

    return fail(
      createDiagnostic(
        'error',
        'FLOW_EXPORT_DEFINITION_UNAVAILABLE',
        `Flow ${flow.uniqueName ?? flow.name ?? flow.id} does not expose a supported definition payload in workflows.clientdata.`,
        {
          source: '@pp/flow',
          hint:
            clientDataKeys.length > 0 || propertiesKeys.length > 0
              ? `Remote export checked workflows.clientdata.definition and workflows.clientdata.properties.definition. Top-level keys: ${clientDataKeys.join(', ') || '(none)'}; properties keys: ${propertiesKeys.join(', ') || '(none)'}.`
              : 'Remote export currently requires workflows.clientdata.definition or workflows.clientdata.properties.definition to be present and JSON-shaped.',
        }
      )
    );
  }

  return normalizeFlowArtifactDocument(
    {
      id: flow.id,
      name: flow.name,
      description: flow.description,
      uniquename: flow.uniqueName,
      category: flow.category,
      ...workflowMetadata,
      ...(workflowState.stateCode !== undefined ? { statecode: workflowState.stateCode } : {}),
      ...(workflowState.statusCode !== undefined ? { statuscode: workflowState.statusCode } : {}),
      ...(flow.clientData ? { clientdata: stableStringify(cloneJsonValue(flow.clientData)) } : {}),
      properties: {
        definition: cloneJsonValue(definition),
        ...(flow.name ? { name: flow.name, displayName: flow.name } : {}),
        ...(flow.description ? { description: flow.description } : {}),
        ...(flow.uniqueName ? { uniquename: flow.uniqueName } : {}),
        ...(flow.category !== undefined ? { category: flow.category } : {}),
        ...workflowMetadata,
        ...(workflowState.stateCode !== undefined ? { statecode: workflowState.stateCode } : {}),
        ...(workflowState.statusCode !== undefined ? { statuscode: workflowState.statusCode } : {}),
      },
    },
    `dataverse://workflows/${flow.id}`
  );
}

function normalizeFlowRun(record: DataverseCloudFlowRunSummary): FlowRunSummary {
  return {
    id: record.id,
    workflowId: record.workflowId,
    workflowName: record.workflowName,
    status: record.status,
    startTime: record.startTime,
    endTime: record.endTime,
    durationMs: record.durationMs,
    retryCount: record.retryCount,
    errorCode: record.errorCode,
    errorMessage: record.errorMessage,
    ...(record.actions ? { actions: record.actions.map(normalizeFlowRunAction) } : {}),
  };
}

function normalizeFlowRunAction(action: CloudFlowRunActionSummary): FlowRunActionSummary {
  return {
    name: action.name,
    status: action.status,
    startTime: action.startTime,
    endTime: action.endTime,
    durationMs: action.durationMs,
    code: action.code,
    errorCode: action.errorCode,
    errorMessage: action.errorMessage,
  };
}

function normalizeStatus(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function hasFlowSolutionPackageImportOverrides(options: FlowPromoteOptions): boolean {
  return (
    options.publishWorkflows !== undefined ||
    options.overwriteUnmanagedCustomizations !== undefined ||
    options.holdingSolution !== undefined ||
    options.skipProductUpdateDependencies !== undefined ||
    options.importJobId !== undefined
  );
}

function summarizeFlowRuns(runs: FlowRunSummary[]): FlowRuntimeAnalyticsSummary {
  const statusCounts = new Map<string, number>();
  const durations = runs.map((run) => run.durationMs).filter(isDefinedNumber).sort((left, right) => left - right);
  const retryCounts = runs.map((run) => run.retryCount ?? 0);
  const dailyTrends = new Map<
    string,
    {
      total: number;
      failed: number;
      succeeded: number;
      other: number;
      durations: number[];
      totalRetries: number;
    }
  >();

  for (const run of runs) {
    const status = normalizeRuntimeStatusLabel(run.status);
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);

    const date = run.startTime?.slice(0, 10);

    if (date) {
      const entry = dailyTrends.get(date) ?? {
        total: 0,
        failed: 0,
        succeeded: 0,
        other: 0,
        durations: [],
        totalRetries: 0,
      };
      entry.total += 1;
      entry.totalRetries += run.retryCount ?? 0;

      if (normalizeStatus(run.status) === 'failed') {
        entry.failed += 1;
      } else if (normalizeStatus(run.status) === 'succeeded') {
        entry.succeeded += 1;
      } else {
        entry.other += 1;
      }

      if (isDefinedNumber(run.durationMs)) {
        entry.durations.push(run.durationMs);
      }

      dailyTrends.set(date, entry);
    }
  }

  return {
    statusCounts: Array.from(statusCounts.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((left, right) => right.count - left.count || left.status.localeCompare(right.status)),
    durationMs: {
      min: durations[0],
      max: durations[durations.length - 1],
      average: averageIntegers(durations),
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
    },
    retry: {
      retriedRuns: retryCounts.filter((count) => count > 0).length,
      totalRetries: retryCounts.reduce((total, count) => total + count, 0),
      maxRetryCount: retryCounts.length > 0 ? Math.max(...retryCounts) : 0,
    },
    dailyTrends: Array.from(dailyTrends.entries())
      .map(([date, entry]) => ({
        date,
        total: entry.total,
        failed: entry.failed,
        succeeded: entry.succeeded,
        other: entry.other,
        averageDurationMs: averageIntegers(entry.durations),
        totalRetries: entry.totalRetries,
      }))
      .sort((left, right) => right.date.localeCompare(left.date)),
  };
}

function resolveLatestFlowRunTimestamp(
  runtimeSummary: FlowRuntimeAnalyticsSummary,
  latestFailure: FlowRunSummary | undefined
): string | undefined {
  const dailyLatest = runtimeSummary.dailyTrends
    .map((entry) => entry.date)
    .sort((left, right) => right.localeCompare(left))[0];

  return latestFailure?.startTime ?? (dailyLatest ? `${dailyLatest}T00:00:00.000Z` : undefined);
}

function summarizeFlowMonitoringHealth(
  report: FlowDoctorReport,
  latestRunAt: string | undefined
): FlowMonitorReport['health'] {
  if (report.invalidConnectionReferences.length > 0 || report.missingEnvironmentVariables.length > 0) {
    return {
      status: 'blocked',
      telemetryState: report.recentRuns.total > 0 || report.errorGroups.length > 0 ? 'active' : 'blocked',
      latestRunAt,
      summary:
        report.recentRuns.total > 0
          ? 'Runtime monitoring found dependency blockers that can keep the flow unhealthy even when runs are still arriving.'
          : 'Runtime monitoring found dependency blockers and no fresh run history, so the deployment still looks blocked rather than healthy.',
    };
  }

  if (report.recentRuns.failed > 0 || report.errorGroups.length > 0) {
    return {
      status: 'degraded',
      telemetryState: 'active',
      latestRunAt,
      summary: 'Runtime monitoring found recent failed executions or grouped runtime errors in the requested window.',
    };
  }

  if (report.recentRuns.total > 0) {
    return {
      status: 'healthy',
      telemetryState: 'active',
      latestRunAt,
      summary: 'Runtime monitoring found recent executions without new grouped failures or dependency blockers.',
    };
  }

  if (report.flow?.workflowState === 'draft' || report.flow?.workflowState === 'suspended') {
    return {
      status: 'inactive',
      telemetryState: 'quiet',
      latestRunAt,
      summary: `The flow is currently ${report.flow.workflowState}, so quiet runtime telemetry is expected until the flow becomes runnable.`,
    };
  }

  return {
    status: 'unknown',
    telemetryState: 'quiet',
    latestRunAt,
    summary: 'No recent runs or grouped failures were returned, so the current window is quiet but not enough to prove the deployment stayed healthy.',
  };
}

function compareFlowMonitorReports(baseline: FlowMonitorReport, current: FlowMonitorReport): FlowMonitorComparison {
  const baselineGroups = new Map(baseline.errorGroups.map((group) => [group.group, group]));
  const currentGroups = new Map(current.errorGroups.map((group) => [group.group, group]));
  const added: FlowErrorGroup[] = [];
  const removed: FlowErrorGroup[] = [];
  const updated: Array<{
    group: string;
    previous: FlowErrorGroup;
    current: FlowErrorGroup;
  }> = [];
  let unchangedCount = 0;

  for (const [group, currentEntry] of currentGroups) {
    const baselineEntry = baselineGroups.get(group);

    if (!baselineEntry) {
      added.push(currentEntry);
      continue;
    }

    if (areFlowErrorGroupsEqual(baselineEntry, currentEntry)) {
      unchangedCount += 1;
      continue;
    }

    updated.push({
      group,
      previous: baselineEntry,
      current: currentEntry,
    });
  }

  for (const [group, baselineEntry] of baselineGroups) {
    if (!currentGroups.has(group)) {
      removed.push(baselineEntry);
    }
  }

  const healthChanged =
    baseline.health.status !== current.health.status ||
    baseline.health.telemetryState !== current.health.telemetryState ||
    baseline.health.latestRunAt !== current.health.latestRunAt;
  const latestFailureChanged = !areFlowRunsEquivalent(baseline.recentRuns.latestFailure, current.recentRuns.latestFailure);
  const errorGroupsChanged = added.length > 0 || removed.length > 0 || updated.length > 0;
  const changed =
    healthChanged ||
    baseline.recentRuns.total !== current.recentRuns.total ||
    baseline.recentRuns.failed !== current.recentRuns.failed ||
    latestFailureChanged ||
    errorGroupsChanged;

  return {
    baselineCheckedAt: baseline.checkedAt,
    changed,
    health: {
      changed: healthChanged,
      previousStatus: baseline.health.status,
      currentStatus: current.health.status,
      previousTelemetryState: baseline.health.telemetryState,
      currentTelemetryState: current.health.telemetryState,
      previousLatestRunAt: baseline.health.latestRunAt,
      currentLatestRunAt: current.health.latestRunAt,
    },
    recentRuns: {
      totalDelta: current.recentRuns.total - baseline.recentRuns.total,
      failedDelta: current.recentRuns.failed - baseline.recentRuns.failed,
      latestFailureChanged,
      previousLatestFailure: baseline.recentRuns.latestFailure,
      currentLatestFailure: current.recentRuns.latestFailure,
    },
    errorGroups: {
      changed: errorGroupsChanged,
      added,
      removed,
      updated,
      unchangedCount,
    },
    findings: buildFlowMonitorComparisonFindings(baseline, current, {
      changed,
      healthChanged,
      latestFailureChanged,
      added,
      removed,
      updated,
    }),
  };
}

function buildFlowMonitorComparisonFindings(
  baseline: FlowMonitorReport,
  current: FlowMonitorReport,
  context: {
    changed: boolean;
    healthChanged: boolean;
    latestFailureChanged: boolean;
    added: FlowErrorGroup[];
    removed: FlowErrorGroup[];
    updated: Array<{
      group: string;
      previous: FlowErrorGroup;
      current: FlowErrorGroup;
    }>;
  }
): string[] {
  const totalDelta = current.recentRuns.total - baseline.recentRuns.total;
  const failedDelta = current.recentRuns.failed - baseline.recentRuns.failed;

  return [
    context.changed
      ? `Compared against monitor baseline from ${baseline.checkedAt}; runtime state changed since the prior capture.`
      : `Compared against monitor baseline from ${baseline.checkedAt}; health, run counts, latest failure, and grouped errors are unchanged.`,
    context.healthChanged
      ? `Health changed from ${baseline.health.status}/${baseline.health.telemetryState} to ${current.health.status}/${current.health.telemetryState}.`
      : `Health is unchanged at ${current.health.status}/${current.health.telemetryState}.`,
    totalDelta === 0 && failedDelta === 0
      ? `Recent run counts are unchanged at ${current.recentRuns.total} total and ${current.recentRuns.failed} failed.`
      : `Recent runs changed by ${formatSignedCount(totalDelta)} total and ${formatSignedCount(failedDelta)} failed since the prior capture.`,
    describeLatestFailureChange(baseline.recentRuns.latestFailure, current.recentRuns.latestFailure, context.latestFailureChanged),
    context.added.length === 0 && context.removed.length === 0 && context.updated.length === 0
      ? `Grouped runtime errors are unchanged across ${current.errorGroups.length} groups.`
      : `Grouped runtime errors changed: ${context.added.length} added, ${context.removed.length} removed, ${context.updated.length} updated.`,
  ];
}

function describeLatestFailureChange(
  baseline?: FlowRunSummary,
  current?: FlowRunSummary,
  changed = false
): string {
  if (!baseline && !current) {
    return 'Latest failure is unchanged because neither capture reported a failed run.';
  }

  if (!changed) {
    return `Latest failure is unchanged at ${describeFlowRunForComparison(current)}.`;
  }

  if (!baseline && current) {
    return `Latest failure changed from none to ${describeFlowRunForComparison(current)}.`;
  }

  if (baseline && !current) {
    return `Latest failure cleared since the prior capture; baseline had ${describeFlowRunForComparison(baseline)}.`;
  }

  return `Latest failure changed from ${describeFlowRunForComparison(baseline)} to ${describeFlowRunForComparison(current)}.`;
}

function describeFlowRunForComparison(run?: FlowRunSummary): string {
  if (!run) {
    return 'no failure';
  }

  const parts = [run.id];

  if (run.startTime) {
    parts.push(run.startTime);
  }

  if (run.errorCode) {
    parts.push(run.errorCode);
  }

  return parts.join(' @ ');
}

function formatSignedCount(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function areFlowRunsEquivalent(left?: FlowRunSummary, right?: FlowRunSummary): boolean {
  return (
    left?.id === right?.id &&
    left?.startTime === right?.startTime &&
    left?.status === right?.status &&
    left?.errorCode === right?.errorCode &&
    left?.errorMessage === right?.errorMessage
  );
}

function areFlowErrorGroupsEqual(left: FlowErrorGroup, right: FlowErrorGroup): boolean {
  return (
    left.group === right.group &&
    left.count === right.count &&
    left.latestRunId === right.latestRunId &&
    left.latestStatus === right.latestStatus &&
    left.latestStartTime === right.latestStartTime &&
    left.sampleErrorCode === right.sampleErrorCode &&
    left.sampleErrorMessage === right.sampleErrorMessage &&
    left.averageDurationMs === right.averageDurationMs &&
    left.totalRetries === right.totalRetries &&
    left.maxRetryCount === right.maxRetryCount
  );
}

function normalizeRuntimeStatusLabel(value: string | undefined): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    return 'Unknown';
  }

  return trimmed;
}

function percentile(values: number[], quantile: number): number | undefined {
  if (values.length === 0) {
    return undefined;
  }

  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * quantile) - 1));
  return values[index];
}

function averageIntegers(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }

  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

function dedupeStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => v !== undefined))];
}

function isDefinedNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isAfterRelativeTime(value: string | undefined, relative: string): boolean {
  if (!value) {
    return false;
  }

  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    return false;
  }

  const match = relative.match(/^(\d+)([dh])$/i);

  if (!match) {
    return true;
  }

  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  const now = Date.now();
  const offset = unit === 'h' ? amount * 60 * 60 * 1000 : amount * 24 * 60 * 60 * 1000;

  return date.valueOf() >= now - offset;
}

function resolveFlowErrorGroup(
  run: FlowRunSummary,
  flow: FlowInspectResult | undefined,
  groupBy: 'errorCode' | 'errorMessage' | 'connectionReference'
): string {
  switch (groupBy) {
    case 'errorMessage':
      return run.errorMessage ?? 'unknown-message';
    case 'connectionReference': {
      const errorText = `${run.errorCode ?? ''} ${run.errorMessage ?? ''}`.toLowerCase();
      const match = flow?.connectionReferences.find((reference) =>
        errorText.includes(reference.name.toLowerCase()) ||
        errorText.includes((reference.connectionReferenceLogicalName ?? '').toLowerCase())
      );
      return match?.name ?? 'unknown-connection-reference';
    }
    case 'errorCode':
    default:
      return run.errorCode ?? 'unknown-error-code';
  }
}

function countRunsForReference(runs: FlowRunSummary[], referenceName: string): number {
  return runs.filter((run) =>
    `${run.errorCode ?? ''} ${run.errorMessage ?? ''}`.toLowerCase().includes(referenceName.toLowerCase())
  ).length;
}

async function resolveFlowArtifactPath(path: string): Promise<OperationResult<string>> {
  const directPath = resolve(path);

  if (await fileExists(directPath)) {
    const metadata = await stat(directPath);
    return ok(metadata.isDirectory() ? resolve(directPath, 'flow.json') : directPath, {
      supportTier: 'preview',
    });
  }

  const directoryPath = resolve(path, 'flow.json');

  if (await fileExists(directoryPath)) {
    return ok(directoryPath, {
      supportTier: 'preview',
    });
  }

  return fail(
    createDiagnostic('error', 'FLOW_ARTIFACT_NOT_FOUND', `Flow artifact ${path} was not found.`, {
      source: '@pp/flow',
      hint: 'Provide a raw flow export JSON file or a directory containing flow.json.',
    })
  );
}

async function readFlowJsonFile(path: string): Promise<OperationResult<unknown>> {
  try {
    return ok(await readJsonFile<unknown>(path), {
      supportTier: 'preview',
    });
  } catch (error) {
    return fail(
      createDiagnostic('error', 'FLOW_JSON_READ_FAILED', `Failed to read flow JSON from ${path}.`, {
        source: '@pp/flow',
        detail: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

function normalizeFlowArtifactDocument(value: unknown, sourcePath: string): OperationResult<FlowArtifact> {
  const record = asRecord(value);

  if (!record) {
    return fail(
      createDiagnostic('error', 'FLOW_ARTIFACT_INVALID', `Flow artifact ${sourcePath} must be a JSON object.`, {
        source: '@pp/flow',
      })
    );
  }

  if (record.kind === 'pp.flow.artifact' && record.schemaVersion === 1) {
    return normalizeCanonicalFlowArtifact(record, sourcePath);
  }

  return normalizeRawFlowArtifact(record, sourcePath);
}

function normalizeCanonicalFlowArtifact(record: Record<string, unknown>, sourcePath: string): OperationResult<FlowArtifact> {
  const metadata = asRecord(record.metadata);
  const definition = asRecord(record.definition);
  const clientData = asRecord(record.clientData);

  if (!metadata || !definition) {
    return fail(
      createDiagnostic('error', 'FLOW_CANONICAL_FIELDS_REQUIRED', `Canonical flow artifact ${sourcePath} must include metadata and definition objects.`, {
        source: '@pp/flow',
      })
    );
  }

  const connectionReferences = normalizeConnectionReferences(metadata.connectionReferences ?? []);
  const parameters = normalizeFlowParameters(metadata.parameters);
  const environmentVariables = collectEnvironmentVariablesFromValue(definition);

  return ok(
    {
      schemaVersion: 1,
      kind: 'pp.flow.artifact',
      metadata: {
        id: readString(metadata.id),
        name: readString(metadata.name),
        displayName: readString(metadata.displayName),
        description: readString(metadata.description),
        uniqueName: readString(metadata.uniqueName),
        category: readNumber(metadata.category),
        workflowMetadata: normalizeFlowWorkflowShellMetadata({
          ...(asRecord(metadata.workflowMetadata) ?? {}),
          type: readNumber(metadata.type) ?? readNumber(asRecord(metadata.workflowMetadata)?.type),
          mode: readNumber(metadata.mode) ?? readNumber(asRecord(metadata.workflowMetadata)?.mode),
          onDemand:
            readBoolean(metadata.onDemand) ??
            readBoolean(metadata.ondemand) ??
            readBoolean(asRecord(metadata.workflowMetadata)?.onDemand),
          primaryEntity:
            readString(metadata.primaryEntity) ??
            readString(metadata.primaryentity) ??
            readString(asRecord(metadata.workflowMetadata)?.primaryEntity),
        }),
        stateCode: readNumber(metadata.stateCode),
        statusCode: readNumber(metadata.statusCode),
        sourcePath: readString(metadata.sourcePath) ?? sourcePath,
        connectionReferences,
        parameters,
        environmentVariables,
      },
      definition: stripNoisyFlowValue(normalizeFlowJsonRecord(definition)) as Record<string, FlowJsonValue>,
      clientData: clientData ? normalizeFlowClientDataRecord(clientData) : undefined,
      unknown: asRecord(record.unknown)
        ? (stripNoisyFlowValue(normalizeFlowJsonRecord(record.unknown as Record<string, unknown>)) as Record<string, FlowJsonValue>)
        : undefined,
    },
    {
      supportTier: 'preview',
    }
  );
}

function normalizeRawFlowArtifact(record: Record<string, unknown>, sourcePath: string): OperationResult<FlowArtifact> {
  const properties = asRecord(record.properties) ?? {};
  const definition = asRecord(properties.definition) ?? asRecord(record.definition) ?? {};
  const rawClientData = readString(record.clientdata) ?? readString(properties.clientdata);
  const parsedClientData = parseFlowClientData(rawClientData);
  const parsed = parseFlowClientDataFromValue({
    ...record,
    ...properties,
    definition,
  });
  const parameters = {
    ...normalizeFlowParameters(record.parameters),
    ...normalizeFlowParameters(properties.parameters),
    ...Object.fromEntries(parsed.parameters.map((name) => [name, null as FlowJsonValue])),
  };
  const unknown = Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !['properties', 'definition', 'clientdata'].includes(key))
      .map(([key, nested]) => [key, normalizeFlowJsonValue(nested)])
  );

  return ok(
    {
      schemaVersion: 1,
      kind: 'pp.flow.artifact',
      metadata: {
        id: readString(record.id) ?? readString(record.workflowid),
        name: readString(record.name) ?? readString(properties.name),
        displayName: readString(record.displayName) ?? readString(properties.displayName) ?? readString(record.name),
        description: readString(record.description) ?? readString(properties.description),
        uniqueName: readString(record.uniquename) ?? readString(properties.uniquename),
        category: readNumber(record.category) ?? readNumber(properties.category),
        workflowMetadata: normalizeFlowWorkflowShellMetadata({
          type: readNumber(record.type) ?? readNumber(properties.type),
          mode: readNumber(record.mode) ?? readNumber(properties.mode),
          onDemand: readBoolean(record.ondemand) ?? readBoolean(properties.ondemand),
          primaryEntity: readString(record.primaryentity) ?? readString(properties.primaryentity),
        }),
        stateCode: readNumber(record.statecode) ?? readNumber(properties.statecode),
        statusCode: readNumber(record.statuscode) ?? readNumber(properties.statuscode),
        sourcePath,
        connectionReferences: parsed.connectionReferences,
        parameters,
        environmentVariables: parsed.environmentVariables,
      },
      definition: stripNoisyFlowValue(normalizeFlowJsonRecord(definition)) as Record<string, FlowJsonValue>,
      clientData: parsedClientData.clientData ? extractFlowClientDataExtras(parsedClientData.clientData) : undefined,
      unknown: Object.keys(unknown).length > 0 ? (stripNoisyFlowValue(unknown) as Record<string, FlowJsonValue>) : undefined,
    },
    {
      supportTier: 'preview',
    }
  );
}

function buildFlowArtifactSummary(path: string, artifact: FlowArtifact): FlowArtifactSummary {
  return {
    path,
    normalized: true,
    name: artifact.metadata.displayName ?? artifact.metadata.name,
    definitionHash: sha256Hex(stableStringify(artifact.definition as unknown as Parameters<typeof stableStringify>[0])),
    connectionReferenceCount: artifact.metadata.connectionReferences.length,
    parameterCount: Object.keys(artifact.metadata.parameters).length,
    environmentVariableCount: artifact.metadata.environmentVariables.length,
  };
}

function resolveFlowDeployTargetIdentifier(artifact: FlowArtifact, explicitTarget?: string): string | undefined {
  return (
    explicitTarget ??
    artifact.metadata.uniqueName ??
    artifact.metadata.name ??
    artifact.metadata.displayName ??
    artifact.metadata.id
  );
}

function resolveFlowCreateIdentifier(artifact: FlowArtifact): string | undefined {
  return artifact.metadata.uniqueName;
}

function resolveFlowCreateTargetMismatch(artifact: FlowArtifact, explicitTarget: string | undefined): boolean {
  if (!explicitTarget) {
    return false;
  }

  const supportedIdentifiers = new Set(
    [
      artifact.metadata.uniqueName,
      artifact.metadata.name,
      artifact.metadata.displayName,
      artifact.metadata.id,
    ].filter((value): value is string => Boolean(value))
  );

  return !supportedIdentifiers.has(explicitTarget);
}

function resolveFlowTargetUniqueNameMismatch(
  artifact: FlowArtifact,
  remoteFlow: FlowInspectResult
): {
  artifactUniqueName: string;
  remoteUniqueName: string;
} | undefined {
  const artifactUniqueName = artifact.metadata.uniqueName?.trim();
  const remoteUniqueName = remoteFlow.uniqueName?.trim();

  if (!artifactUniqueName || !remoteUniqueName) {
    return undefined;
  }

  if (artifactUniqueName.toLowerCase() === remoteUniqueName.toLowerCase()) {
    return undefined;
  }

  return {
    artifactUniqueName,
    remoteUniqueName,
  };
}

function validateFlowWorkflowStateMetadata(artifact: FlowArtifact, path: string): Diagnostic[] {
  const state = resolveSupportedFlowWorkflowState(artifact.metadata.stateCode, artifact.metadata.statusCode);

  if (state.valid) {
    return [];
  }

  const detailParts = [
    artifact.metadata.stateCode !== undefined ? `statecode=${artifact.metadata.stateCode}` : undefined,
    artifact.metadata.statusCode !== undefined ? `statuscode=${artifact.metadata.statusCode}` : undefined,
  ].filter((value): value is string => Boolean(value));

  return [
    createDiagnostic(
      'error',
      'FLOW_WORKFLOW_STATE_UNSUPPORTED',
      `Flow artifact ${path} has an unsupported workflow state/status combination${detailParts.length > 0 ? ` (${detailParts.join(', ')})` : ''}.`,
      {
        source: '@pp/flow',
        path,
        hint: state.reason,
      }
    ),
  ];
}

function validateFlowWorkflowCategoryMetadata(artifact: FlowArtifact, path: string): Diagnostic[] {
  const category = resolveSupportedFlowWorkflowCategory(artifact.metadata.category);

  if (category.valid) {
    return [];
  }

  return [
    createDiagnostic(
      'error',
      'FLOW_WORKFLOW_CATEGORY_UNSUPPORTED',
      `Flow artifact ${path} has an unsupported workflow category${artifact.metadata.category !== undefined ? ` (${artifact.metadata.category})` : ''}.`,
      {
        source: '@pp/flow',
        path,
        hint: category.reason,
      }
    ),
  ];
}

function validateFlowWorkflowShellMetadata(artifact: FlowArtifact, path: string): Diagnostic[] {
  const workflowMetadata = resolveSupportedFlowWorkflowShellMetadata(artifact.metadata.workflowMetadata);

  if (workflowMetadata.valid) {
    return [];
  }

  return [
    createDiagnostic(
      'error',
      'FLOW_WORKFLOW_METADATA_UNSUPPORTED',
      `Flow artifact ${path} has unsupported workflow shell metadata.`,
      {
        source: '@pp/flow',
        path,
        hint: workflowMetadata.reason,
      }
    ),
  ];
}

function resolveSupportedFlowWorkflowCategory(category: number | undefined): {
  valid: boolean;
  category?: number;
  reason?: string;
} {
  if (category === undefined) {
    return {
      valid: true,
      category: SUPPORTED_FLOW_WORKFLOW_CATEGORY,
    };
  }

  if (category !== SUPPORTED_FLOW_WORKFLOW_CATEGORY) {
    return {
      valid: false,
      reason: `Supported flow artifacts currently target Dataverse cloud flows only, which use workflow category ${SUPPORTED_FLOW_WORKFLOW_CATEGORY}.`,
    };
  }

  return {
    valid: true,
    category,
  };
}

function resolveSupportedFlowWorkflowShellMetadata(workflowMetadata: FlowWorkflowShellMetadata | undefined): {
  valid: boolean;
  workflowMetadata?: FlowWorkflowShellMetadata;
  reason?: string;
} {
  if (workflowMetadata?.type !== undefined && workflowMetadata.type !== SUPPORTED_FLOW_WORKFLOW_TYPE) {
    return {
      valid: false,
      reason: `Supported cloud flows currently require workflow type ${SUPPORTED_FLOW_WORKFLOW_TYPE}.`,
    };
  }

  if (workflowMetadata?.mode !== undefined && workflowMetadata.mode !== SUPPORTED_FLOW_WORKFLOW_MODE) {
    return {
      valid: false,
      reason: `Supported cloud flows currently require workflow mode ${SUPPORTED_FLOW_WORKFLOW_MODE}.`,
    };
  }

  if (workflowMetadata?.onDemand !== undefined && workflowMetadata.onDemand !== SUPPORTED_FLOW_WORKFLOW_ON_DEMAND) {
    return {
      valid: false,
      reason: `Supported cloud flows currently require ondemand=${String(SUPPORTED_FLOW_WORKFLOW_ON_DEMAND)}.`,
    };
  }

  if (
    workflowMetadata?.primaryEntity !== undefined &&
    workflowMetadata.primaryEntity !== SUPPORTED_FLOW_WORKFLOW_PRIMARY_ENTITY
  ) {
    return {
      valid: false,
      reason: `Supported cloud flows currently require primaryentity=${SUPPORTED_FLOW_WORKFLOW_PRIMARY_ENTITY}.`,
    };
  }

  return {
    valid: true,
    workflowMetadata: {
      type: workflowMetadata?.type ?? SUPPORTED_FLOW_WORKFLOW_TYPE,
      mode: workflowMetadata?.mode ?? SUPPORTED_FLOW_WORKFLOW_MODE,
      onDemand: workflowMetadata?.onDemand ?? SUPPORTED_FLOW_WORKFLOW_ON_DEMAND,
      primaryEntity: workflowMetadata?.primaryEntity ?? SUPPORTED_FLOW_WORKFLOW_PRIMARY_ENTITY,
    },
  };
}

function applyFlowWorkflowStateOverride(artifact: FlowArtifact, workflowState: FlowWorkflowStateLabel | undefined): FlowArtifact {
  if (!workflowState) {
    return artifact;
  }

  const stateCode = FLOW_WORKFLOW_STATE_LABEL_STATE.get(workflowState);

  if (stateCode === undefined) {
    return artifact;
  }

  return {
    ...artifact,
    metadata: {
      ...artifact.metadata,
      stateCode,
      statusCode: FLOW_WORKFLOW_STATE_DEFAULT_STATUS.get(stateCode),
    },
  };
}

function resolveSupportedFlowWorkflowState(
  stateCode: number | undefined,
  statusCode: number | undefined
): {
  valid: boolean;
  stateCode?: number;
  statusCode?: number;
  reason?: string;
} {
  if (stateCode === undefined && statusCode === undefined) {
    return {
      valid: true,
    };
  }

  if (stateCode !== undefined && !FLOW_WORKFLOW_STATE_DEFAULT_STATUS.has(stateCode)) {
    return {
      valid: false,
      reason: 'Supported workflow state codes are 0 (Draft), 1 (Activated), and 2 (Suspended).',
    };
  }

  if (statusCode !== undefined && !FLOW_WORKFLOW_STATUS_STATE.has(statusCode)) {
    return {
      valid: false,
      reason: 'Supported workflow status codes are 1 (Draft), 2 (Activated), and 3 (Suspended).',
    };
  }

  if (stateCode !== undefined && statusCode !== undefined) {
    const expectedStatusCode = FLOW_WORKFLOW_STATE_DEFAULT_STATUS.get(stateCode);

    if (expectedStatusCode !== statusCode) {
      return {
        valid: false,
        reason: `Workflow statecode ${stateCode} expects statuscode ${expectedStatusCode}.`,
      };
    }

    return {
      valid: true,
      stateCode,
      statusCode,
    };
  }

  if (stateCode !== undefined) {
    return {
      valid: true,
      stateCode,
      statusCode: FLOW_WORKFLOW_STATE_DEFAULT_STATUS.get(stateCode),
    };
  }

  return {
    valid: true,
    stateCode: statusCode !== undefined ? FLOW_WORKFLOW_STATUS_STATE.get(statusCode) : undefined,
    statusCode,
  };
}

function resolveFlowResultWorkflowState(
  stateCode: number | undefined,
  statusCode: number | undefined
): {
  workflowState?: FlowWorkflowStateLabel;
  stateCode?: number;
  statusCode?: number;
} {
  const workflowState = resolveSupportedFlowWorkflowState(stateCode, statusCode);
  const workflowStateLabel = resolveFlowWorkflowStateLabel(workflowState.stateCode, workflowState.statusCode);

  return {
    ...(workflowStateLabel ? { workflowState: workflowStateLabel } : {}),
    ...(workflowState.stateCode !== undefined ? { stateCode: workflowState.stateCode } : {}),
    ...(workflowState.statusCode !== undefined ? { statusCode: workflowState.statusCode } : {}),
  };
}

function resolveFlowWorkflowStateLabel(
  stateCode: number | undefined,
  statusCode: number | undefined
): FlowWorkflowStateLabel | undefined {
  const normalizedStateCode = resolveSupportedFlowWorkflowState(stateCode, statusCode).stateCode;

  if (normalizedStateCode === undefined) {
    return undefined;
  }

  for (const [label, supportedStateCode] of FLOW_WORKFLOW_STATE_LABEL_STATE.entries()) {
    if (supportedStateCode === normalizedStateCode) {
      return label;
    }
  }

  return undefined;
}

function normalizeFlowWorkflowShellMetadata(value: {
  type?: number;
  mode?: number;
  onDemand?: boolean;
  primaryEntity?: string;
}): FlowWorkflowShellMetadata | undefined {
  const workflowMetadata = {
    ...(value.type !== undefined ? { type: value.type } : {}),
    ...(value.mode !== undefined ? { mode: value.mode } : {}),
    ...(value.onDemand !== undefined ? { onDemand: value.onDemand } : {}),
    ...(value.primaryEntity ? { primaryEntity: value.primaryEntity } : {}),
  };

  return Object.keys(workflowMetadata).length > 0 ? workflowMetadata : undefined;
}

function buildRawFlowWorkflowShellFields(workflowMetadata: FlowWorkflowShellMetadata | undefined): Record<string, FlowJsonValue> {
  const effectiveMetadata = resolveSupportedFlowWorkflowShellMetadata(workflowMetadata).workflowMetadata;

  return {
    ...(effectiveMetadata?.type !== undefined ? { type: effectiveMetadata.type } : {}),
    ...(effectiveMetadata?.mode !== undefined ? { mode: effectiveMetadata.mode } : {}),
    ...(effectiveMetadata?.onDemand !== undefined ? { ondemand: effectiveMetadata.onDemand } : {}),
    ...(effectiveMetadata?.primaryEntity ? { primaryentity: effectiveMetadata.primaryEntity } : {}),
  };
}

function buildDataverseFlowWorkflowShellFields(
  workflowMetadata: FlowWorkflowShellMetadata | undefined
): Record<string, unknown> {
  const effectiveMetadata = resolveSupportedFlowWorkflowShellMetadata(workflowMetadata).workflowMetadata;

  return {
    ...(effectiveMetadata?.type !== undefined ? { type: effectiveMetadata.type } : {}),
    ...(effectiveMetadata?.mode !== undefined ? { mode: effectiveMetadata.mode } : {}),
    ...(effectiveMetadata?.onDemand !== undefined ? { ondemand: effectiveMetadata.onDemand } : {}),
    ...(effectiveMetadata?.primaryEntity ? { primaryentity: effectiveMetadata.primaryEntity } : {}),
  };
}

function buildFlowDeployClientData(artifact: FlowArtifact): string {
  return buildFlowClientData(artifact);
}

function buildFlowClientData(
  artifact: FlowArtifact,
  options: {
    forceTopLevelDefinition?: boolean;
    forcePropertiesDefinition?: boolean;
    stripConnectionParameterValues?: boolean;
  } = {}
): string {
  const existingClientData = artifact.clientData
    ? ((cloneJsonValue(artifact.clientData) as Record<string, FlowJsonValue>) ?? {})
    : {};
  const existingClientDataRecord = asFlowJsonRecord(existingClientData) ?? {};
  const existingProperties = asFlowJsonRecord(existingClientDataRecord.properties);
  const hadTopLevelDefinition = asFlowJsonRecord(existingClientDataRecord.definition) !== undefined;
  const hadPropertiesDefinition = existingProperties ? asFlowJsonRecord(existingProperties.definition) !== undefined : false;
  const includeTopLevelDefinition =
    options.forceTopLevelDefinition ?? (hadTopLevelDefinition || (!artifact.clientData && !hadPropertiesDefinition));
  const includePropertiesDefinition =
    options.forcePropertiesDefinition ?? (hadPropertiesDefinition || !includeTopLevelDefinition);
  const definition = options.stripConnectionParameterValues
    ? sanitizeFlowDefinitionForWorkflowPatch(artifact.definition)
    : cloneJsonValue(artifact.definition);

  return stableStringify({
    ...existingClientDataRecord,
    schemaVersion: resolveFlowClientDataSchemaVersion(existingClientDataRecord.schemaVersion),
    ...(includeTopLevelDefinition ? { definition } : {}),
    ...(includePropertiesDefinition
      ? {
          properties: {
            ...(existingProperties ? cloneJsonValue(existingProperties) : {}),
            definition,
          },
        }
      : existingProperties
        ? {
            properties: cloneJsonValue(existingProperties),
          }
        : {}),
  });
}

function resolveFlowClientDataSchemaVersion(value: unknown): string | number {
  if (value === undefined || value === null) {
    return 1;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (trimmed && trimmed !== '1') {
      return trimmed;
    }
  }

  if (typeof value === 'number' && value !== 1) {
    return String(value);
  }

  return '1.0.0.0';
}

function sanitizeFlowDefinitionForWorkflowPatch(definition: Record<string, FlowJsonValue>): Record<string, FlowJsonValue> {
  const cloned = (cloneJsonValue(definition) as Record<string, FlowJsonValue>) ?? {};
  const parameters = asFlowJsonRecord(cloned.parameters);
  const connections = parameters ? asFlowJsonRecord(parameters['$connections']) : undefined;

  if (connections && 'value' in connections) {
    delete connections.value;
  }

  return cloned;
}

function buildFlowDeployCreateEntity(artifact: FlowArtifact): Record<string, unknown> {
  const workflowState = resolveSupportedFlowWorkflowState(artifact.metadata.stateCode, artifact.metadata.statusCode);
  const workflowCategory = resolveSupportedFlowWorkflowCategory(artifact.metadata.category);

  return {
    category: workflowCategory.category ?? SUPPORTED_FLOW_WORKFLOW_CATEGORY,
    ...buildDataverseFlowWorkflowShellFields(artifact.metadata.workflowMetadata),
    name: artifact.metadata.displayName ?? artifact.metadata.name ?? artifact.metadata.uniqueName,
    ...(artifact.metadata.description ? { description: artifact.metadata.description } : {}),
    uniquename: artifact.metadata.uniqueName,
    clientdata: buildFlowClientData(artifact, {
      forceTopLevelDefinition: true,
      forcePropertiesDefinition: true,
    }),
    ...(workflowState.stateCode !== undefined ? { statecode: workflowState.stateCode } : {}),
    ...(workflowState.statusCode !== undefined ? { statuscode: workflowState.statusCode } : {}),
  };
}

function buildFlowDeployUpdateEntity(artifact: FlowArtifact): Record<string, unknown> {
  const workflowState = resolveSupportedFlowWorkflowState(artifact.metadata.stateCode, artifact.metadata.statusCode);
  const workflowCategory = resolveSupportedFlowWorkflowCategory(artifact.metadata.category);

  return {
    clientdata: buildFlowDeployClientData(artifact),
    ...(artifact.metadata.displayName || artifact.metadata.name
      ? {
          name: artifact.metadata.displayName ?? artifact.metadata.name,
        }
      : {}),
    ...(artifact.metadata.description ? { description: artifact.metadata.description } : {}),
    ...(workflowCategory.category !== undefined ? { category: workflowCategory.category } : {}),
    ...buildDataverseFlowWorkflowShellFields(artifact.metadata.workflowMetadata),
    ...(workflowState.stateCode !== undefined ? { statecode: workflowState.stateCode } : {}),
    ...(workflowState.statusCode !== undefined ? { statuscode: workflowState.statusCode } : {}),
  };
}

function buildFlowActivationUpdateEntity(artifact: FlowArtifact): Record<string, unknown> {
  const workflowState = resolveSupportedFlowWorkflowState(artifact.metadata.stateCode, artifact.metadata.statusCode);

  return {
    clientdata: buildFlowClientData(artifact, {
      stripConnectionParameterValues: true,
    }),
    ...(workflowState.stateCode !== undefined ? { statecode: workflowState.stateCode } : {}),
    ...(workflowState.statusCode !== undefined ? { statuscode: workflowState.statusCode } : {}),
  };
}

function buildFlowActivationTopLevelDefinitionUpdateEntity(artifact: FlowArtifact): Record<string, unknown> {
  const workflowState = resolveSupportedFlowWorkflowState(artifact.metadata.stateCode, artifact.metadata.statusCode);

  return {
    clientdata: buildFlowClientData(artifact, {
      forceTopLevelDefinition: true,
      forcePropertiesDefinition: true,
      stripConnectionParameterValues: true,
    }),
    ...(workflowState.stateCode !== undefined ? { statecode: workflowState.stateCode } : {}),
    ...(workflowState.statusCode !== undefined ? { statuscode: workflowState.statusCode } : {}),
  };
}

function buildFlowActivationStateOnlyUpdateEntity(artifact: FlowArtifact): Record<string, unknown> {
  const workflowState = resolveSupportedFlowWorkflowState(artifact.metadata.stateCode, artifact.metadata.statusCode);

  return {
    ...(workflowState.stateCode !== undefined ? { statecode: workflowState.stateCode } : {}),
    ...(workflowState.statusCode !== undefined ? { statuscode: workflowState.statusCode } : {}),
  };
}

function buildFlowActivationStateCodeOnlyUpdateEntity(artifact: FlowArtifact): Record<string, unknown> {
  const workflowState = resolveSupportedFlowWorkflowState(artifact.metadata.stateCode, artifact.metadata.statusCode);

  return {
    ...(workflowState.stateCode !== undefined ? { statecode: workflowState.stateCode } : {}),
  };
}

function buildRawFlowArtifactDocument(artifact: FlowArtifact): Record<string, FlowJsonValue> {
  const workflowState = resolveSupportedFlowWorkflowState(artifact.metadata.stateCode, artifact.metadata.statusCode);
  const workflowCategory = resolveSupportedFlowWorkflowCategory(artifact.metadata.category);
  const workflowMetadata = buildRawFlowWorkflowShellFields(artifact.metadata.workflowMetadata);
  const record: Record<string, FlowJsonValue> = {
    ...(artifact.unknown ? cloneJsonValue(artifact.unknown) : {}),
    ...(artifact.metadata.name ? { name: artifact.metadata.name } : {}),
    ...(artifact.metadata.description ? { description: artifact.metadata.description } : {}),
    ...(artifact.metadata.uniqueName ? { uniquename: artifact.metadata.uniqueName } : {}),
    ...(workflowCategory.category !== undefined ? { category: workflowCategory.category } : {}),
    ...workflowMetadata,
    ...(workflowState.stateCode !== undefined ? { statecode: workflowState.stateCode } : {}),
    ...(workflowState.statusCode !== undefined ? { statuscode: workflowState.statusCode } : {}),
    ...(artifact.clientData || Object.keys(artifact.definition).length > 0
      ? {
          clientdata: buildFlowDeployClientData(artifact),
        }
      : {}),
    properties: {
      definition: cloneJsonValue(artifact.definition),
      ...(artifact.metadata.displayName ? { displayName: artifact.metadata.displayName } : {}),
      ...(artifact.metadata.name ? { name: artifact.metadata.name } : {}),
      ...(artifact.metadata.description ? { description: artifact.metadata.description } : {}),
      ...(artifact.metadata.uniqueName ? { uniquename: artifact.metadata.uniqueName } : {}),
      ...(workflowCategory.category !== undefined ? { category: workflowCategory.category } : {}),
      ...workflowMetadata,
      ...(workflowState.stateCode !== undefined ? { statecode: workflowState.stateCode } : {}),
      ...(workflowState.statusCode !== undefined ? { statuscode: workflowState.statusCode } : {}),
    },
  };

  if (artifact.metadata.id) {
    record.id = artifact.metadata.id;
  }

  return record;
}

function normalizeFlowClientDataRecord(record: Record<string, unknown>): Record<string, FlowJsonValue> {
  return stripNoisyFlowValue(normalizeFlowJsonRecord(record)) as Record<string, FlowJsonValue>;
}

function extractFlowClientDataExtras(clientData: Record<string, FlowJsonValue>): Record<string, FlowJsonValue> | undefined {
  const extras = Object.fromEntries(Object.entries(clientData).filter(([key]) => key !== 'definition'));

  if (Object.keys(extras).length === 0) {
    return undefined;
  }

  return normalizeFlowClientDataRecord(extras);
}

function parseFlowClientData(clientdata: string | undefined): {
  clientData?: Record<string, FlowJsonValue>;
  definition?: Record<string, FlowJsonValue>;
  connectionReferences: FlowConnectionReference[];
  parameters: string[];
  environmentVariables: string[];
} {
  if (!clientdata) {
    return {
      connectionReferences: [],
      parameters: [],
      environmentVariables: [],
    };
  }

  try {
    const parsed = JSON.parse(clientdata) as unknown;
    return parseFlowClientDataFromValue(parsed);
  } catch {
    return {
      connectionReferences: [],
      parameters: [],
      environmentVariables: [],
    };
  }
}

function parseFlowClientDataFromValue(value: unknown): {
  clientData?: Record<string, FlowJsonValue>;
  definition?: Record<string, FlowJsonValue>;
  connectionReferences: FlowConnectionReference[];
  parameters: string[];
  environmentVariables: string[];
} {
  const record = asRecord(value);
  const definition = asRecord(record?.definition) ?? asRecord(asRecord(record?.properties)?.definition);
  const definitionParameters = asRecord(definition?.parameters);
  const definitionConnections = asRecord(asRecord(definitionParameters?.['$connections'])?.value);
  const connectionReferences = normalizeConnectionReferences(
    record?.connectionReferences ??
      asRecord(record?.properties)?.connectionReferences ??
      definitionConnections
  );
  const parameterNames = collectParameterNames(definition ?? {});
  const environmentVariables = collectEnvironmentVariablesFromValue(definition ?? {});

  return {
    clientData: record ? (normalizeFlowJsonRecord(record) as Record<string, FlowJsonValue>) : undefined,
    definition: definition ? (normalizeFlowJsonRecord(definition) as Record<string, FlowJsonValue>) : undefined,
    connectionReferences,
    parameters: parameterNames,
    environmentVariables,
  };
}

function normalizeConnectionReferences(value: unknown): FlowConnectionReference[] {
  const records =
    Array.isArray(value)
      ? value
      : asRecord(value)
        ? Object.entries(asRecord(value) ?? {}).map(([key, nested]) => ({ name: key, ...(asRecord(nested) ?? {}) }))
        : [];
  const normalized: FlowConnectionReference[] = [];

  for (const item of records) {
    const record = asRecord(item);

    if (!record) {
      continue;
    }

    const api = asRecord(record.api);
    const name = readString(record.name);

    if (!name) {
      continue;
    }

    normalized.push({
      name,
      connectionReferenceLogicalName:
        readString(record.connectionReferenceLogicalName) ??
        readString(record.connectionreferencelogicalname) ??
        readString(record.logicalName),
      connectionId: readString(record.connectionId) ?? readString(record.id) ?? readString(record.connectionid),
      apiId: readString(record.apiId) ?? readString(api?.id) ?? readString(record.connectorId),
    });
  }

  return normalized.sort((left, right) => left.name.localeCompare(right.name));
}

function analyzeFlowSemantics(artifact: FlowArtifact, sourcePath: string): FlowSemanticAnalysis {
  const diagnostics: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  const definition = asRecord(artifact.definition) ?? {};
  const intermediateRepresentation = buildFlowIntermediateRepresentation(artifact);
  const allNodes = new Map(intermediateRepresentation.nodes.map((node) => [node.name, node] as const));
  const triggerNodes = intermediateRepresentation.nodes.filter((node) => node.kind === 'trigger');
  const actionNodes = intermediateRepresentation.nodes.filter((node) => node.kind !== 'trigger');
  const actionNodeNames = new Set(actionNodes.map((node) => node.name));
  const parameterNames = new Set([
    ...Object.keys(normalizeFlowParameters(artifact.metadata.parameters)),
    ...Object.keys(normalizeFlowParameters(asRecord(definition.parameters))),
  ]);
  const definitionConnectionReferences = collectDefinitionConnectionReferences(definition);
  const metadataConnectionReferences = new Map(
    artifact.metadata.connectionReferences.map((reference) => [reference.name, reference] as const)
  );
  const allConnectionReferences = new Map<string, FlowDefinitionConnectionReference | FlowConnectionReference>([
    ...Array.from(definitionConnectionReferences.entries()),
    ...artifact.metadata.connectionReferences.map((reference) => [reference.name, reference] as const),
  ]);
  const variableNames = new Set(intermediateRepresentation.nodes.flatMap((node) => node.variableUsage.initializes));
  const references = intermediateRepresentation.nodes.flatMap((node) => node.dataFlow.dynamicContentReferences);
  const expressions = intermediateRepresentation.nodes.flatMap((node) => node.dataFlow.expressions);
  const connectionReferenceUsages = collectConnectionReferenceUsages(artifact.definition);
  const hasDefinitionConnections = definitionConnectionReferences.size > 0;
  const writeOperations = intermediateRepresentation.nodes.flatMap((node) => node.dataFlow.writes);

  for (const node of allNodes.values()) {
    for (const dependency of node.controlFlow.unresolvedDependsOn) {
      if (!allNodes.has(dependency)) {
        diagnostics.push(
          createDiagnostic(
            'error',
            'FLOW_RUN_AFTER_TARGET_MISSING',
            `Flow node ${node.name} depends on missing runAfter target ${dependency}.`,
            {
              source: '@pp/flow',
              path: `${node.path}.runAfter.${dependency}`,
            }
          )
        );
      }
    }
  }

  for (const write of writeOperations) {
    if (variableNames.has(write.name)) {
      continue;
    }

    diagnostics.push(
      createDiagnostic(
        'error',
        'FLOW_VARIABLE_TARGET_UNRESOLVED',
        `Flow variable operation targets missing variable ${write.name}.`,
        {
          source: '@pp/flow',
          path: write.path,
        }
      )
    );
  }

  for (const reference of references) {
    switch (reference.kind) {
      case 'parameter':
        if (!parameterNames.has(reference.name)) {
          diagnostics.push(
            createDiagnostic(
              'error',
              'FLOW_PARAMETER_REFERENCE_UNRESOLVED',
              `Flow expression references missing parameter ${reference.name}.`,
              {
                source: '@pp/flow',
                path: reference.path,
              }
            )
          );
        }
        break;
      case 'action':
        if (!actionNodeNames.has(reference.name)) {
          diagnostics.push(
            createDiagnostic(
              'error',
              'FLOW_ACTION_REFERENCE_UNRESOLVED',
              `Flow expression references missing action ${reference.name}.`,
              {
                source: '@pp/flow',
                path: reference.path,
              }
            )
          );
        }
        break;
      case 'variable':
        if (!variableNames.has(reference.name)) {
          diagnostics.push(
            createDiagnostic(
              'error',
              'FLOW_VARIABLE_REFERENCE_UNRESOLVED',
              `Flow expression references missing variable ${reference.name}.`,
              {
                source: '@pp/flow',
                path: reference.path,
              }
            )
          );
        }
        break;
      case 'environmentVariable':
      default:
        break;
    }
  }

  if (hasDefinitionConnections) {
    for (const reference of artifact.metadata.connectionReferences) {
      const definitionReference = definitionConnectionReferences.get(reference.name);

      if (!definitionReference) {
        diagnostics.push(
          createDiagnostic(
            'error',
            'FLOW_CONNREF_DEFINITION_ENTRY_MISSING',
            `Flow connection reference ${reference.name} is declared in metadata but missing from definition.parameters.$connections.`,
            {
              source: '@pp/flow',
              path: `definition.parameters.$connections.value.${reference.name}`,
            }
          )
        );
        continue;
      }

      if (
        reference.connectionReferenceLogicalName &&
        definitionReference.connectionReferenceLogicalName &&
        reference.connectionReferenceLogicalName !== definitionReference.connectionReferenceLogicalName
      ) {
        diagnostics.push(
          createDiagnostic(
            'error',
            'FLOW_CONNREF_LOGICAL_NAME_MISMATCH',
            `Flow connection reference ${reference.name} has mismatched logical names between metadata and definition.`,
            {
              source: '@pp/flow',
              path: `definition.parameters.$connections.value.${reference.name}.connectionReferenceLogicalName`,
            }
          )
        );
      }

      if (reference.apiId && definitionReference.apiId && reference.apiId !== definitionReference.apiId) {
        diagnostics.push(
          createDiagnostic(
            'error',
            'FLOW_CONNREF_API_ID_MISMATCH',
            `Flow connection reference ${reference.name} has mismatched apiId values between metadata and definition.`,
            {
              source: '@pp/flow',
              path: `definition.parameters.$connections.value.${reference.name}.apiId`,
            }
          )
        );
      }
    }

    for (const [name] of definitionConnectionReferences) {
      if (metadataConnectionReferences.has(name)) {
        continue;
      }

      diagnostics.push(
        createDiagnostic(
          'error',
          'FLOW_CONNREF_METADATA_MISSING',
          `Flow definition references connection ${name} in $connections but metadata.connectionReferences does not declare it.`,
          {
            source: '@pp/flow',
            path: `definition.parameters.$connections.value.${name}`,
          }
        )
      );
    }
  }

  for (const usage of connectionReferenceUsages) {
    if (metadataConnectionReferences.has(usage.name) || definitionConnectionReferences.has(usage.name)) {
      continue;
    }

    diagnostics.push(
      createDiagnostic(
        'error',
        'FLOW_CONNREF_REFERENCE_UNRESOLVED',
        `Flow expression references missing connection reference ${usage.name}.`,
        {
          source: '@pp/flow',
          path: usage.path,
        }
      )
    );
  }

  for (const [name, node] of allNodes) {
    const nested = readNodeAtPath(artifact.definition, parseFlowPath(node.path));
    const nodeRecord = asRecord(nested);
    const connectorContract = readConnectorActionContract(nodeRecord, node.path);
    const retryPolicy = asRecord(asRecord(nodeRecord?.runtimeConfiguration)?.retryPolicy);
    const concurrency = asRecord(asRecord(nodeRecord?.runtimeConfiguration)?.concurrency);
    const concurrencyRuns = readNumber(concurrency?.runs);
    const retryCount = readNumber(retryPolicy?.count);

    if (connectorContract) {
      if (!connectorContract.connectionPath) {
        diagnostics.push(
          createDiagnostic(
            'error',
            'FLOW_CONNECTOR_CONNECTION_REFERENCE_MISSING',
            `Connector action ${name} does not declare inputs.host.connection.name.`,
            {
              source: '@pp/flow',
              path: `${node.path}.inputs.host.connection.name`,
            }
          )
        );
      } else if (!connectorContract.connectionReferenceSupported) {
        diagnostics.push(
          createDiagnostic(
            'error',
            'FLOW_CONNECTOR_CONNECTION_REFERENCE_UNSUPPORTED',
            `Connector action ${name} uses an unsupported connection reference shape; expected @parameters('$connections')['<name>']['connectionId'].`,
            {
              source: '@pp/flow',
              path: connectorContract.connectionPath,
            }
          )
        );
      }

      if (!connectorContract.apiId) {
        diagnostics.push(
          createDiagnostic('error', 'FLOW_CONNECTOR_API_ID_MISSING', `Connector action ${name} does not declare inputs.host.apiId.`, {
            source: '@pp/flow',
            path: `${node.path}.inputs.host.apiId`,
          })
        );
      }

      if (!connectorContract.operationId) {
        diagnostics.push(
          createDiagnostic(
            'error',
            'FLOW_CONNECTOR_OPERATION_ID_MISSING',
            `Connector action ${name} does not declare a supported operationId.`,
            {
              source: '@pp/flow',
              path: `${node.path}.inputs.operationId`,
            }
          )
        );
      }

      if (connectorContract.apiId && connectorContract.connectionReferenceName) {
        const connectionReference = allConnectionReferences.get(connectorContract.connectionReferenceName);
        const referenceApiId = normalizeConnectorApiId(connectionReference?.apiId);
        const actionApiId = normalizeConnectorApiId(connectorContract.apiId);

        if (referenceApiId && actionApiId && referenceApiId !== actionApiId) {
          diagnostics.push(
            createDiagnostic(
              'error',
              'FLOW_CONNECTOR_API_ID_MISMATCH',
              `Connector action ${name} declares apiId ${connectorContract.apiId} but connection reference ${connectorContract.connectionReferenceName} resolves to ${connectionReference?.apiId}.`,
              {
                source: '@pp/flow',
                path: `${node.path}.inputs.host.apiId`,
              }
            )
          );
        }
      }

      const connectionReference = connectorContract.connectionReferenceName
        ? allConnectionReferences.get(connectorContract.connectionReferenceName)
        : undefined;
      const supportedOperation = resolveSupportedConnectorOperation(connectorContract, connectionReference);

      if (supportedOperation) {
        const inputs = asRecord(nodeRecord?.inputs);
        const missingBucketGroups = new Set<string>();

        for (const parameter of supportedOperation.parameters) {
          const supportedBuckets = resolveConnectorParameterBuckets(parameter);
          const bucketRecords = supportedBuckets.map((bucket) => ({
            bucket,
            record: readConnectorInputBucket(inputs, bucket),
          }));
          const presentBucketRecords = bucketRecords.filter((entry) => entry.record);
          const valueEntry = presentBucketRecords.find((entry) => entry.record?.[parameter.name] !== undefined);
          const prefixedFieldEntry =
            !valueEntry && parameter.allowPrefixedFields
              ? presentBucketRecords
                  .map((entry) => ({
                    bucket: entry.bucket,
                    fields: findConnectorPrefixedFieldEntries(entry.record, parameter.name),
                  }))
                  .find((entry) => entry.fields.length > 0)
              : undefined;
          const parameterBucket = valueEntry?.bucket ?? prefixedFieldEntry?.bucket ?? supportedBuckets[0] ?? 'parameters';
          const parameterPath = describeConnectorParameterPath(node.path, parameterBucket, parameter.name);

          if (!valueEntry && !prefixedFieldEntry) {
            if (parameter.required && presentBucketRecords.length === 0) {
              const bucketGroupKey = supportedBuckets.join('|');

              if (!missingBucketGroups.has(bucketGroupKey)) {
                const bucketDescription = describeConnectorSupportedBuckets(supportedBuckets);
                const diagnosticCode =
                  supportedBuckets.length === 1 && supportedBuckets[0] === 'parameters'
                    ? 'FLOW_CONNECTOR_PARAMETERS_OBJECT_MISSING'
                    : 'FLOW_CONNECTOR_INPUT_BUCKET_MISSING';

                diagnostics.push(
                  createDiagnostic(
                    'error',
                    diagnosticCode,
                    `Connector action ${name} does not declare any supported ${bucketDescription} object required by ${supportedOperation.operationId}.`,
                    {
                      source: '@pp/flow',
                      path: node.path,
                    }
                  )
                );
                missingBucketGroups.add(bucketGroupKey);
              }
            } else if (parameter.required) {
              diagnostics.push(
                createDiagnostic(
                  'error',
                  'FLOW_CONNECTOR_PARAMETER_REQUIRED_MISSING',
                  `Connector action ${name} is missing required parameter ${parameter.name} for ${supportedOperation.operationId}.`,
                  {
                    source: '@pp/flow',
                    path: parameterPath,
                  }
                )
              );
            }

            continue;
          }

          if (prefixedFieldEntry) {
            for (const field of prefixedFieldEntry.fields) {
              const fieldIssue = validateConnectorRecordFieldValue(field.value);

              if (!fieldIssue) {
                continue;
              }

              diagnostics.push(
                createDiagnostic(
                  'error',
                  'FLOW_CONNECTOR_PARAMETER_SHAPE_UNSUPPORTED',
                  `Connector action ${name} parameter ${field.name} for ${supportedOperation.operationId} ${fieldIssue}.`,
                  {
                    source: '@pp/flow',
                    path: describeConnectorParameterPath(node.path, prefixedFieldEntry.bucket, field.name),
                  }
                )
              );
            }

            continue;
          }

          const value = valueEntry?.record?.[parameter.name];

          const parameterIssue = validateConnectorParameterValue(value, parameter.kind);

          if (parameterIssue) {
            diagnostics.push(
              createDiagnostic(
                'error',
                'FLOW_CONNECTOR_PARAMETER_SHAPE_UNSUPPORTED',
                `Connector action ${name} parameter ${parameter.name} for ${supportedOperation.operationId} ${parameterIssue}.`,
                {
                  source: '@pp/flow',
                  path: parameterPath,
                }
              )
            );
            continue;
          }

          if (
            parameter.required &&
            ((typeof value === 'string' && !value.trim()) ||
              (parameter.kind === 'record' &&
                typeof value === 'object' &&
                value !== null &&
                !Array.isArray(value) &&
                Object.keys(value as Record<string, unknown>).length === 0))
          ) {
            diagnostics.push(
              createDiagnostic(
                'error',
                'FLOW_CONNECTOR_PARAMETER_REQUIRED_MISSING',
                `Connector action ${name} is missing required parameter ${parameter.name} for ${supportedOperation.operationId}.`,
                {
                  source: '@pp/flow',
                  path: parameterPath,
                }
              )
            );
          }
        }
      }
    }

    if (concurrencyRuns !== undefined && concurrencyRuns > 1) {
      warnings.push(
        createDiagnostic(
          'warning',
          node.kind === 'trigger' ? 'FLOW_TRIGGER_CONCURRENCY_ENABLED' : 'FLOW_ACTION_CONCURRENCY_ENABLED',
          `Flow ${node.kind} ${name} enables concurrency with ${concurrencyRuns} parallel runs.`,
          {
            source: '@pp/flow',
            path: `${node.path}.runtimeConfiguration.concurrency.runs`,
          }
        )
      );
    }

    if (retryCount !== undefined && retryCount < 0) {
      diagnostics.push(
        createDiagnostic('error', 'FLOW_RETRY_POLICY_INVALID', `Flow node ${name} has a negative retry count ${retryCount}.`, {
          source: '@pp/flow',
          path: `${node.path}.runtimeConfiguration.retryPolicy.count`,
        })
      );
    }

    if (retryCount !== undefined && retryCount > 10) {
      warnings.push(
        createDiagnostic(
          'warning',
          'FLOW_RETRY_POLICY_HIGH',
          `Flow node ${name} configures retry count ${retryCount}, which may mask persistent failures.`,
          {
            source: '@pp/flow',
            path: `${node.path}.runtimeConfiguration.retryPolicy.count`,
          }
        )
      );
    }
  }

  return {
    intermediateRepresentation: summarizeFlowIntermediateRepresentation(intermediateRepresentation),
    summary: {
      triggerCount: triggerNodes.length,
      actionCount: actionNodes.length,
      scopeCount: intermediateRepresentation.scopeCount,
      expressionCount: expressions.length,
      templateExpressionCount: expressions.filter((expression) => expression.syntax === 'template').length,
      initializedVariables: Array.from(variableNames).sort(),
      variableUsage: {
        reads: intermediateRepresentation.nodes.reduce((total, node) => total + node.variableUsage.reads.length, 0),
        writes: intermediateRepresentation.nodes.reduce((total, node) => total + node.variableUsage.writes.length, 0),
      },
      dynamicContentReferenceCount: references.length,
      controlFlowEdgeCount: intermediateRepresentation.controlFlowEdgeCount,
      referenceCounts: {
        parameters: references.filter((reference) => reference.kind === 'parameter').length,
        environmentVariables: references.filter((reference) => reference.kind === 'environmentVariable').length,
        actions: references.filter((reference) => reference.kind === 'action').length,
        variables: references.filter((reference) => reference.kind === 'variable').length,
        connectionReferences: references.filter((reference) => reference.kind === 'connectionReference').length,
      },
    },
    diagnostics: diagnostics.sort(compareDiagnostics),
    warnings: warnings.sort(compareDiagnostics),
  };
}

function normalizeFlowParameters(value: unknown): Record<string, FlowJsonValue> {
  const record = asRecord(value);

  if (!record) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, nested]) => {
      const nestedRecord = asRecord(nested);
      const parameterValue = nestedRecord && 'defaultValue' in nestedRecord ? nestedRecord.defaultValue : nested;
      return [key, normalizeFlowJsonValue(parameterValue)];
    })
  );
}

function collectParameterNames(value: Record<string, unknown>): string[] {
  const parameterNames = new Set<string>();
  const definitionParameters = asRecord(value.parameters);

  for (const key of Object.keys(definitionParameters ?? {})) {
    if (key !== '$connections') {
      parameterNames.add(key);
    }
  }

  scanFlowStrings(value, /parameters\('([^']+)'\)/g, (match) => {
    if (match !== '$connections') {
      parameterNames.add(match);
    }
  });
  return Array.from(parameterNames).sort();
}

function collectEnvironmentVariablesFromValue(value: unknown): string[] {
  const variables = new Set<string>();
  scanFlowStrings(value, /environmentVariables\('([^']+)'\)/g, (match) => variables.add(match));
  return Array.from(variables).sort();
}

function buildFlowIntermediateRepresentation(artifact: FlowArtifact): FlowIntermediateRepresentation {
  const definition = asRecord(artifact.definition) ?? {};
  const nodes: FlowIntermediateNode[] = [];
  const childIdsByParent = new Map<string, string[]>();

  const registerChildren = (parentId: string | undefined, childId: string): void => {
    if (!parentId) {
      return;
    }

    const siblings = childIdsByParent.get(parentId) ?? [];
    siblings.push(childId);
    childIdsByParent.set(parentId, siblings);
  };

  const collectNodes = (
    value: Record<string, unknown> | undefined,
    kind: 'trigger' | 'action',
    pathPrefix: string,
    parentId: string | undefined,
    branch: FlowNodeBranch
  ): void => {
    for (const [name, nested] of Object.entries(value ?? {})) {
      const record = asRecord(nested);

      if (!record) {
        continue;
      }

      const type = readString(record.type);
      const nodeKind: FlowNodeKind = kind === 'trigger' ? 'trigger' : isFlowScopeType(type) ? 'scope' : 'action';
      const path = `${pathPrefix}.${name}`;
      const id = `${nodeKind}:${path}`;
      const nodeSemanticSlice = withoutChildBranches(record);
      const expressions = collectFlowExpressionUsages(nodeSemanticSlice, `definition.${path}`);
      const dynamicContentReferences = expressions.flatMap((expression) => expression.references);
      const variableWrites = collectVariableWrites(nodeSemanticSlice, `definition.${path}`);
      const initializedVariables = variableWrites.filter((write) => write.operation === 'initialize').map((write) => write.name);
      const variableReads = dynamicContentReferences
        .filter((reference) => reference.kind === 'variable')
        .map((reference) => reference.name)
        .sort();
      const variableWriteNames = variableWrites.map((write) => write.name).sort();
      nodes.push({
        id,
        name,
        kind: nodeKind,
        type,
        path,
        parentId,
        branch,
        runAfter: Object.keys(asRecord(record.runAfter) ?? {}).sort(),
        childIds: [],
        controlFlow: {
          dependsOn: [],
          unresolvedDependsOn: [],
          dependentIds: [],
        },
        dataFlow: {
          expressions,
          reads: dynamicContentReferences.filter((reference) => reference.kind !== 'connectionReference'),
          writes: variableWrites,
          dynamicContentReferences,
        },
        variableUsage: {
          initializes: initializedVariables.sort(),
          reads: variableReads,
          writes: variableWriteNames,
        },
      });
      registerChildren(parentId, id);

      collectNodes(asRecord(record.actions), 'action', `${path}.actions`, id, 'actions');

      const elseRecord = asRecord(record.else);
      collectNodes(asRecord(elseRecord?.actions), 'action', `${path}.else.actions`, id, 'else');

      const cases = asRecord(record.cases);
      for (const [caseName, caseValue] of Object.entries(cases ?? {})) {
        collectNodes(asRecord(asRecord(caseValue)?.actions), 'action', `${path}.cases.${caseName}.actions`, id, `case:${caseName}`);
      }

      const defaultRecord = asRecord(record.default);
      collectNodes(asRecord(defaultRecord?.actions), 'action', `${path}.default.actions`, id, 'default');
    }
  };

  collectNodes(asRecord(definition.triggers), 'trigger', 'triggers', undefined, 'root');
  collectNodes(asRecord(definition.actions), 'action', 'actions', undefined, 'root');

  const finalizedNodes = nodes
    .map((node) => ({
      ...node,
      childIds: (childIdsByParent.get(node.id) ?? []).sort(),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));

  const nodeIdByName = new Map(finalizedNodes.map((node) => [node.name, node.id] as const));
  const dependentIdsByNode = new Map<string, string[]>();

  for (const node of finalizedNodes) {
    const dependsOn = node.runAfter.map((dependency) => nodeIdByName.get(dependency)).filter((value): value is string => Boolean(value));

    for (const dependencyId of dependsOn) {
      const dependents = dependentIdsByNode.get(dependencyId) ?? [];
      dependents.push(node.id);
      dependentIdsByNode.set(dependencyId, dependents);
    }

    node.controlFlow = {
      dependsOn: dependsOn.sort(),
      unresolvedDependsOn: node.runAfter.filter((dependency) => !nodeIdByName.has(dependency)).sort(),
      dependentIds: [],
    };
  }

  for (const node of finalizedNodes) {
    node.controlFlow.dependentIds = (dependentIdsByNode.get(node.id) ?? []).sort();
  }

  const summary = summarizeFlowIntermediateRepresentation({
    nodes: finalizedNodes,
    triggerCount: finalizedNodes.filter((node) => node.kind === 'trigger').length,
    actionCount: finalizedNodes.filter((node) => node.kind !== 'trigger').length,
    scopeCount: finalizedNodes.filter((node) => node.kind === 'scope').length,
  });

  return {
    artifactName: artifact.metadata.displayName ?? artifact.metadata.name,
    nodes: finalizedNodes,
    ...summary,
  };
}

function summarizeFlowIntermediateRepresentation(
  model: Pick<FlowIntermediateRepresentation, 'nodes' | 'triggerCount' | 'actionCount' | 'scopeCount'>
): FlowIntermediateRepresentationSummary {
  return {
    nodeCount: model.nodes.length,
    triggerCount: model.triggerCount,
    actionCount: model.actionCount,
    scopeCount: model.scopeCount,
    controlFlowEdgeCount: model.nodes.reduce((total, node) => total + node.controlFlow.dependsOn.length, 0),
    expressionCount: model.nodes.reduce((total, node) => total + node.dataFlow.expressions.length, 0),
    templateExpressionCount: model.nodes.reduce(
      (total, node) => total + node.dataFlow.expressions.filter((expression) => expression.syntax === 'template').length,
      0
    ),
    dynamicContentReferenceCount: model.nodes.reduce((total, node) => total + node.dataFlow.dynamicContentReferences.length, 0),
    variableReadCount: model.nodes.reduce((total, node) => total + node.variableUsage.reads.length, 0),
    variableWriteCount: model.nodes.reduce((total, node) => total + node.variableUsage.writes.length, 0),
  };
}

function buildFlowGraphReport(artifact: FlowArtifact): FlowGraphReport {
  const intermediateRepresentation = buildFlowIntermediateRepresentation(artifact);
  const definition = asRecord(artifact.definition) ?? {};
  const declaredParameters = new Set([
    ...Object.keys(normalizeFlowParameters(artifact.metadata.parameters)),
    ...Object.keys(normalizeFlowParameters(asRecord(definition.parameters))),
  ].filter((name) => name !== '$connections'));
  const declaredEnvironmentVariables = new Set(artifact.metadata.environmentVariables);
  const declaredConnectionReferences = new Set([
    ...artifact.metadata.connectionReferences.map((reference) => reference.name),
    ...Array.from(collectDefinitionConnectionReferences(definition).keys()),
  ]);
  const nodesByName = new Map(intermediateRepresentation.nodes.map((node) => [node.name, node] as const));
  const variableGraph = new Map<
    string,
    {
      name: string;
      initializedBy: Set<string>;
      readBy: Set<string>;
      writtenBy: Set<string>;
    }
  >();
  const edges: FlowGraphEdge[] = [];

  for (const node of intermediateRepresentation.nodes) {
    for (const childId of node.childIds) {
      edges.push({
        from: node.id,
        to: childId,
        kind: 'containment',
        resolved: true,
      });
    }

    for (const dependencyId of node.controlFlow.dependsOn) {
      edges.push({
        from: node.id,
        to: dependencyId,
        kind: 'runAfter',
        resolved: true,
      });
    }

    for (const unresolvedDependency of node.controlFlow.unresolvedDependsOn) {
      edges.push({
        from: node.id,
        to: `action:${unresolvedDependency}`,
        kind: 'runAfter',
        resolved: false,
      });
    }

    for (const reference of node.dataFlow.dynamicContentReferences) {
      if (reference.kind === 'parameter') {
        edges.push({
          from: node.id,
          to: `parameter:${reference.name}`,
          kind: 'parameterReference',
          path: reference.path,
          resolved: declaredParameters.has(reference.name),
        });
        continue;
      }

      if (reference.kind === 'environmentVariable') {
        edges.push({
          from: node.id,
          to: `environmentVariable:${reference.name}`,
          kind: 'environmentVariableReference',
          path: reference.path,
          resolved: declaredEnvironmentVariables.has(reference.name),
        });
        continue;
      }

      if (reference.kind === 'connectionReference') {
        edges.push({
          from: node.id,
          to: `connectionReference:${reference.name}`,
          kind: 'connectionReferenceReference',
          path: reference.path,
          resolved: declaredConnectionReferences.has(reference.name),
        });
        continue;
      }

      if (reference.kind === 'action') {
        const targetNode = nodesByName.get(reference.name);
        edges.push({
          from: node.id,
          to: targetNode?.id ?? `action:${reference.name}`,
          kind: 'actionReference',
          path: reference.path,
          resolved: Boolean(targetNode),
        });
        continue;
      }

      if (reference.kind === 'variable') {
        const variable = getOrCreateVariableGraph(variableGraph, reference.name);
        variable.readBy.add(node.id);
        edges.push({
          from: node.id,
          to: `variable:${reference.name}`,
          kind: 'variableReference',
          path: reference.path,
          resolved: variable.initializedBy.size > 0 || intermediateRepresentation.nodes.some((candidate) => candidate.variableUsage.initializes.includes(reference.name)),
        });
      }
    }

    for (const variableName of node.variableUsage.initializes) {
      getOrCreateVariableGraph(variableGraph, variableName).initializedBy.add(node.id);
    }

    for (const write of node.dataFlow.writes) {
      const variable = getOrCreateVariableGraph(variableGraph, write.name);
      variable.writtenBy.add(node.id);
      edges.push({
        from: node.id,
        to: `variable:${write.name}`,
        kind: 'variableWrite',
        path: write.path,
        resolved: variable.initializedBy.size > 0 || write.operation === 'initialize',
      });
    }
  }

  const nodes = intermediateRepresentation.nodes.map((node) => ({
    id: node.id,
    name: node.name,
    kind: node.kind,
    type: node.type,
    path: node.path,
    parentId: node.parentId,
    branch: node.branch,
    childIds: node.childIds,
    dependsOn: node.controlFlow.dependsOn,
    unresolvedDependsOn: node.controlFlow.unresolvedDependsOn,
    dependentIds: node.controlFlow.dependentIds,
    referenceCounts: {
      parameters: node.dataFlow.dynamicContentReferences.filter((reference) => reference.kind === 'parameter').length,
      environmentVariables: node.dataFlow.dynamicContentReferences.filter((reference) => reference.kind === 'environmentVariable').length,
      connectionReferences: node.dataFlow.dynamicContentReferences.filter((reference) => reference.kind === 'connectionReference').length,
      actions: node.dataFlow.dynamicContentReferences.filter((reference) => reference.kind === 'action').length,
      variables: node.dataFlow.dynamicContentReferences.filter((reference) => reference.kind === 'variable').length,
    },
    variableUsage: node.variableUsage,
  }));
  const hotspots = intermediateRepresentation.nodes
    .flatMap((node) => {
      const referenceDensity = node.dataFlow.dynamicContentReferences.length;
      const records: Array<{
        kind: 'controlFanIn' | 'controlFanOut' | 'referenceDensity';
        nodeId: string;
        nodeName: string;
        metric: number;
      }> = [];

      if (node.controlFlow.dependentIds.length > 0) {
        records.push({
          kind: 'controlFanIn',
          nodeId: node.id,
          nodeName: node.name,
          metric: node.controlFlow.dependentIds.length,
        });
      }

      if (node.controlFlow.dependsOn.length + node.controlFlow.unresolvedDependsOn.length > 0) {
        records.push({
          kind: 'controlFanOut',
          nodeId: node.id,
          nodeName: node.name,
          metric: node.controlFlow.dependsOn.length + node.controlFlow.unresolvedDependsOn.length,
        });
      }

      if (referenceDensity > 0) {
        records.push({
          kind: 'referenceDensity',
          nodeId: node.id,
          nodeName: node.name,
          metric: referenceDensity,
        });
      }

      return records;
    })
    .sort((left, right) => right.metric - left.metric || left.kind.localeCompare(right.kind) || left.nodeId.localeCompare(right.nodeId))
    .slice(0, 10);

  const edgeCounts = Object.fromEntries(
    [
      'containment',
      'runAfter',
      'parameterReference',
      'environmentVariableReference',
      'connectionReferenceReference',
      'actionReference',
      'variableReference',
      'variableWrite',
    ].map((kind) => [kind, edges.filter((edge) => edge.kind === kind).length])
  ) as Record<FlowGraphEdge['kind'], number>;

  return {
    artifactName: intermediateRepresentation.artifactName,
    summary: {
      nodeCount: intermediateRepresentation.nodeCount,
      triggerCount: intermediateRepresentation.triggerCount,
      actionCount: intermediateRepresentation.actionCount,
      scopeCount: intermediateRepresentation.scopeCount,
      edgeCounts,
      unresolvedEdgeCount: edges.filter((edge) => !edge.resolved).length,
    },
    nodes,
    edges: edges.sort(compareFlowGraphEdges),
    resources: {
      parameters: Array.from(declaredParameters).sort(),
      environmentVariables: Array.from(declaredEnvironmentVariables).sort(),
      connectionReferences: Array.from(declaredConnectionReferences).sort(),
      variables: Array.from(variableGraph.values())
        .map((variable) => ({
          name: variable.name,
          initializedBy: Array.from(variable.initializedBy).sort(),
          readBy: Array.from(variable.readBy).sort(),
          writtenBy: Array.from(variable.writtenBy).sort(),
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    },
    hotspots,
  };
}

function buildFlowSourceCorrelationModel(flow: FlowInspectResult): FlowSourceCorrelationModel | undefined {
  const artifact = buildFlowArtifactFromInspectResult(flow);

  if (!artifact) {
    return undefined;
  }

  const graph = buildFlowGraphReport(artifact);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const connectionReferenceNodes = new Map<string, FlowSourceNodeLocation[]>();
  const environmentVariableNodes = new Map<string, FlowSourceNodeLocation[]>();

  for (const edge of graph.edges) {
    if (edge.kind !== 'connectionReferenceReference' && edge.kind !== 'environmentVariableReference') {
      continue;
    }

    const sourceNode = nodesById.get(edge.from);

    if (!sourceNode) {
      continue;
    }

    const [prefix, name] = edge.to.split(':');

    if (!name || (prefix !== 'connectionReference' && prefix !== 'environmentVariable')) {
      continue;
    }

    const target = prefix === 'connectionReference' ? connectionReferenceNodes : environmentVariableNodes;
    const current = target.get(name) ?? [];

    if (!current.some((node) => node.id === sourceNode.id)) {
      current.push(summarizeFlowSourceNode(sourceNode));
      current.sort((left, right) => left.path.localeCompare(right.path));
      target.set(name, current);
    }
  }

  return {
    artifactName: graph.artifactName,
    graph,
    connectionReferenceNodes,
    environmentVariableNodes,
  };
}

function buildFlowArtifactFromInspectResult(flow: FlowInspectResult): FlowArtifact | undefined {
  const parsed = parseFlowClientDataFromValue(flow.clientData);

  if (!parsed.definition) {
    return undefined;
  }

  return {
    schemaVersion: 1,
    kind: 'pp.flow.artifact',
    metadata: {
      id: flow.id,
      name: flow.uniqueName ?? flow.name,
      displayName: flow.name,
      uniqueName: flow.uniqueName,
      workflowMetadata: flow.workflowMetadata,
      stateCode: flow.stateCode,
      statusCode: flow.statusCode,
      connectionReferences: flow.connectionReferences,
      parameters: normalizeFlowParameters(asRecord(parsed.definition.parameters)),
      environmentVariables: flow.environmentVariables,
    },
    definition: normalizeFlowJsonRecord(parsed.definition) as Record<string, FlowJsonValue>,
  };
}

function summarizeFlowSourceNode(node: FlowGraphNodeSummary): FlowSourceNodeLocation {
  return {
    id: node.id,
    name: node.name,
    kind: node.kind,
    type: node.type,
    path: node.path,
  };
}

function correlateFlowErrorGroups(
  errorGroups: FlowErrorGroup[],
  flow: FlowInspectResult,
  sourceCorrelation: FlowSourceCorrelationModel
): NonNullable<FlowDoctorReport['sourceCorrelation']>['errorGroups'] {
  const relatedAliases = flow.connectionReferences
    .flatMap((reference) =>
      [reference.name, reference.connectionReferenceLogicalName].filter((value): value is string => Boolean(value)).map((alias) => ({
        name: reference.name,
        alias,
      }))
    )
    .sort((left, right) => right.alias.length - left.alias.length);
  const correlated: NonNullable<FlowDoctorReport['sourceCorrelation']>['errorGroups'] = [];

  for (const group of errorGroups) {
    const relatedNames = new Set<string>();
    let heuristic: 'group-name' | 'message' | undefined;
    const haystacks = [
      { value: group.group, heuristic: 'group-name' as const },
      { value: group.sampleErrorMessage, heuristic: 'message' as const },
    ];

    for (const haystack of haystacks) {
      const candidate = normalizeCorrelationText(haystack.value);

      if (!candidate) {
        continue;
      }

      for (const alias of relatedAliases) {
        if (!candidate.includes(normalizeCorrelationText(alias.alias))) {
          continue;
        }

        relatedNames.add(alias.name);
        heuristic ??= haystack.heuristic;
      }
    }

    if (relatedNames.size === 0 || !heuristic) {
      continue;
    }

    const sourceNodes = Array.from(
      new Map(
        Array.from(relatedNames)
          .flatMap((name) => sourceCorrelation.connectionReferenceNodes.get(name) ?? [])
          .map((node) => [node.id, node] as const)
      ).values()
    ).sort((left, right) => left.path.localeCompare(right.path));

    correlated.push({
      group: group.group,
      count: group.count,
      relatedConnectionReferences: Array.from(relatedNames).sort(),
      sourceNodes,
      heuristic,
    });
  }

  return correlated;
}

function normalizeCorrelationText(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function readInitializeVariableNames(value: unknown): string[] {
  const record = asRecord(value);
  const inputs = asRecord(record?.inputs);
  const variables = Array.isArray(inputs?.variables) ? inputs?.variables : [];
  const names: string[] = [];

  for (const item of variables) {
    const name = readString(asRecord(item)?.name);
    if (name) {
      names.push(name);
    }
  }

  return names;
}

function collectFlowExpressionUsages(value: unknown, path = 'definition'): FlowExpressionUsage[] {
  const expressions: FlowExpressionUsage[] = [];

  for (const location of collectFlowStrings(value, path)) {
    const wholeExpression = extractWholeFlowExpression(location.value);

    if (wholeExpression) {
      expressions.push({
        path: location.path,
        syntax: 'expression',
        expression: wholeExpression,
        references: collectSupportedReferencesFromExpression(wholeExpression, location.path),
      });
      continue;
    }

    for (const match of location.value.matchAll(/@\{([^{}]+)\}/g)) {
      const expression = match[1]?.trim();

      if (!expression) {
        continue;
      }

      expressions.push({
        path: location.path,
        syntax: 'template',
        expression,
        references: collectSupportedReferencesFromExpression(expression, location.path),
      });
    }
  }

  return expressions;
}

function collectVariableWrites(value: unknown, path: string): FlowVariableWrite[] {
  const record = asRecord(value);
  const inputs = asRecord(record?.inputs);
  const type = readString(record?.type);

  if (!type || !inputs) {
    return [];
  }

  if (type === 'InitializeVariable') {
    return readInitializeVariableNames(value).map((name, index) => ({
      name,
      path: `${path}.inputs.variables.${index}.name`,
      operation: 'initialize',
    }));
  }

  const variableName = readString(inputs.name);

  if (!variableName) {
    return [];
  }

  const operation =
    type === 'SetVariable'
      ? 'set'
      : type === 'AppendToStringVariable' || type === 'AppendToArrayVariable'
        ? 'append'
        : type === 'IncrementVariable'
          ? 'increment'
          : type === 'DecrementVariable'
            ? 'decrement'
            : undefined;

  return operation
    ? [
        {
          name: variableName,
          path: `${path}.inputs.name`,
          operation,
        },
      ]
    : [];
}

function withoutChildBranches(record: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...record };
  delete clone.actions;
  delete clone.else;
  delete clone.cases;
  delete clone.default;
  return clone;
}

function collectDefinitionConnectionReferences(value: Record<string, unknown>): Map<string, FlowDefinitionConnectionReference> {
  const parameterRecord = asRecord(value.parameters);
  const connectionValues = asRecord(asRecord(asRecord(parameterRecord?.['$connections'])?.value));
  const references = new Map<string, FlowDefinitionConnectionReference>();

  for (const [name, nested] of Object.entries(connectionValues ?? {})) {
    const record = asRecord(nested);

    references.set(name, {
      name,
      connectionReferenceLogicalName:
        readString(record?.connectionReferenceLogicalName) ??
        readString(record?.connectionreferencelogicalname) ??
        readString(record?.logicalName),
      apiId: readString(record?.apiId) ?? readString(asRecord(record?.api)?.id) ?? readString(record?.connectorId),
    });
  }

  return references;
}

function collectConnectionReferenceUsages(value: unknown): Array<{ name: string; path: string }> {
  return collectFlowExpressionUsages(value).flatMap((expression) =>
    expression.references
      .filter((reference) => reference.kind === 'connectionReference')
      .map((reference) => ({
        name: reference.name,
        path: reference.path,
      }))
  );
}

function readConnectorActionContract(value: unknown, nodePath: string): FlowConnectorActionContract | undefined {
  const record = asRecord(value);
  const type = readString(record?.type);

  if (type !== 'OpenApiConnection' && type !== 'OpenApiConnectionWebhook') {
    return undefined;
  }

  const inputs = asRecord(record?.inputs);
  const host = asRecord(inputs?.host);
  const connection = asRecord(host?.connection);
  const connectionName = readString(connection?.name) ?? readString(host?.connectionName);
  const connectionPath = readString(connection?.name)
    ? `definition.${nodePath}.inputs.host.connection.name`
    : readString(host?.connectionName)
      ? `definition.${nodePath}.inputs.host.connectionName`
      : undefined;

  return {
    apiId: readString(host?.apiId) ?? readString(asRecord(host?.api)?.id),
    operationId: readString(inputs?.operationId) ?? readString(host?.operationId) ?? readString(record?.operationId),
    connectionReferenceName: extractConnectionReferenceName(connectionName),
    connectionPath,
    connectionReferenceSupported: Boolean(extractConnectionReferenceName(connectionName)),
  };
}

function extractConnectionReferenceName(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const expression = extractWholeFlowExpression(value) ?? value.trim();
  const match = expression.match(
    /^parameters\(\s*['"]\$connections['"]\s*\)\s*\[\s*['"]([^'"]+)['"]\s*\]\s*\[\s*['"]connectionId['"]\s*\]$/i
  );

  if (match?.[1]) {
    return match[1];
  }

  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(expression) ? expression : undefined;
}

function resolveSupportedConnectorOperation(
  connectorContract: FlowConnectorActionContract,
  connectionReference: FlowDefinitionConnectionReference | FlowConnectionReference | undefined
) {
  return resolveFlowSupportedConnectorOperation(
    connectorContract.apiId ?? connectionReference?.apiId,
    connectorContract.operationId
  );
}

function describeFlowJsonShape(value: unknown): string {
  if (Array.isArray(value)) {
    return 'array';
  }

  if (value === null) {
    return 'null';
  }

  return typeof value;
}

function readConnectorInputBucket(
  inputs: Record<string, unknown> | undefined,
  bucket: 'parameters' | 'queries' | 'pathParameters'
): Record<string, unknown> | undefined {
  return asRecord(inputs?.[bucket]);
}

function resolveConnectorParameterBuckets(
  parameter: FlowSupportedConnectorOperationParameter
): Array<'parameters' | 'queries' | 'pathParameters'> {
  if (parameter.buckets && parameter.buckets.length > 0) {
    return [...new Set(parameter.buckets)];
  }

  return [parameter.bucket ?? 'parameters'];
}

function describeConnectorInputBucket(bucket: 'parameters' | 'queries' | 'pathParameters'): string {
  if (bucket === 'pathParameters') {
    return 'inputs.pathParameters';
  }

  if (bucket === 'queries') {
    return 'inputs.queries';
  }

  return 'inputs.parameters';
}

function describeConnectorSupportedBuckets(buckets: Array<'parameters' | 'queries' | 'pathParameters'>): string {
  return buckets.map((bucket) => describeConnectorInputBucket(bucket)).join(' or ');
}

function describeConnectorParameterPath(
  nodePath: string,
  bucket: 'parameters' | 'queries' | 'pathParameters',
  name: string
): string {
  return `${nodePath}.${describeConnectorInputBucket(bucket)}.${name}`;
}

function validateConnectorParameterValue(
  value: unknown,
  kind: FlowSupportedConnectorOperationParameter['kind']
): string | undefined {
  if (kind === 'binary') {
    if (typeof value === 'string') {
      const trimmed = value.trim();

      if (!trimmed) {
        return undefined;
      }

      return undefined;
    }

    const record = asRecord(value);
    const content = record?.['$content'];
    const contentType = record?.['$content-type'];

    if (record) {
      if (content !== undefined && typeof content !== 'string') {
        return `$content must be a string literal or whole expression, not ${describeFlowJsonShape(content)}`;
      }

      if (contentType !== undefined && typeof contentType !== 'string') {
        return `$content-type must be a string literal or whole expression, not ${describeFlowJsonShape(contentType)}`;
      }

      if (typeof content === 'string' || typeof contentType === 'string') {
        return undefined;
      }
    }

    return 'must be a string literal, whole expression, or a $content wrapper object';
  }

  if (kind === 'record') {
    if (typeof value === 'string') {
      const trimmed = value.trim();

      if (!trimmed) {
        return undefined;
      }

      if (extractWholeFlowExpression(trimmed)) {
        return undefined;
      }
    }

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return undefined;
    }

    return `must be an object payload or object-valued expression, not ${describeFlowJsonShape(value)}`;
  }

  if (kind === 'string') {
    if (typeof value !== 'string') {
      return `must be a string expression or literal, not ${describeFlowJsonShape(value)}`;
    }

    return undefined;
  }

  if (kind === 'integer') {
    if (typeof value === 'number' && Number.isInteger(value)) {
      return undefined;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();

      if (!trimmed) {
        return undefined;
      }

      if (extractWholeFlowExpression(trimmed)) {
        return undefined;
      }

      if (/^-?\d+$/.test(trimmed)) {
        return undefined;
      }
    }

    return `must be an integer literal or expression, not ${describeFlowJsonShape(value)}`;
  }

  if (typeof value === 'boolean') {
    return undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (!trimmed) {
      return undefined;
    }

    if (extractWholeFlowExpression(trimmed)) {
      return undefined;
    }

    if (/^(true|false)$/i.test(trimmed)) {
      return undefined;
    }
  }

  return `must be a boolean literal or expression, not ${describeFlowJsonShape(value)}`;
}

function validateConnectorRecordFieldValue(value: unknown): string | undefined {
  if (value === null) {
    return undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (!trimmed) {
      return undefined;
    }

    if (extractWholeFlowExpression(trimmed)) {
      return undefined;
    }

    return undefined;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return undefined;
  }

  return `must be a scalar literal or whole expression, not ${describeFlowJsonShape(value)}`;
}

function findConnectorPrefixedFieldEntries(
  record: Record<string, unknown> | undefined,
  prefix: string
): Array<{ name: string; value: unknown }> {
  if (!record) {
    return [];
  }

  const normalizedPrefix = `${prefix}/`;

  return Object.entries(record)
    .filter(([name]) => name.startsWith(normalizedPrefix))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => ({
      name,
      value,
    }));
}

function getOrCreateVariableGraph(
  graph: Map<
    string,
    {
      name: string;
      initializedBy: Set<string>;
      readBy: Set<string>;
      writtenBy: Set<string>;
    }
  >,
  name: string
): {
  name: string;
  initializedBy: Set<string>;
  readBy: Set<string>;
  writtenBy: Set<string>;
} {
  const existing = graph.get(name);

  if (existing) {
    return existing;
  }

  const created = {
    name,
    initializedBy: new Set<string>(),
    readBy: new Set<string>(),
    writtenBy: new Set<string>(),
  };
  graph.set(name, created);
  return created;
}

function compareFlowGraphEdges(left: FlowGraphEdge, right: FlowGraphEdge): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.from.localeCompare(right.from) ||
    left.to.localeCompare(right.to) ||
    (left.path ?? '').localeCompare(right.path ?? '')
  );
}

function extractWholeFlowExpression(value: string): string | undefined {
  const trimmed = value.trim();

  if (trimmed.startsWith('@{') && trimmed.endsWith('}')) {
    const inner = trimmed.slice(2, -1).trim();
    return inner.length > 0 ? inner : undefined;
  }

  if (/^@[A-Za-z_]/.test(trimmed)) {
    const inner = trimmed.slice(1).trim();
    return inner.length > 0 ? inner : undefined;
  }

  return undefined;
}

function collectSupportedReferencesFromExpression(expression: string, path: string): FlowDynamicContentReference[] {
  const references: FlowDynamicContentReference[] = [];

  for (const match of expression.matchAll(/(parameters|environmentVariables|variables|actions|body|outputs)\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const rawKind = match[1];
    const name = match[2];

    if (!rawKind || !name) {
      continue;
    }

    if (rawKind === 'parameters' && name === '$connections') {
      continue;
    }

    references.push({
      kind:
        rawKind === 'parameters'
          ? 'parameter'
          : rawKind === 'environmentVariables'
            ? 'environmentVariable'
            : rawKind === 'variables'
              ? 'variable'
              : 'action',
      name,
      path,
    });
  }

  for (const match of expression.matchAll(/parameters\(\s*['"]\$connections['"]\s*\)\s*\[\s*['"]([^'"]+)['"]\s*\]/g)) {
    const name = match[1];

    if (!name) {
      continue;
    }

    references.push({
      kind: 'connectionReference',
      name,
      path,
    });
  }

  return references;
}

function collectFlowStrings(value: unknown, path = 'definition'): FlowStringLocation[] {
  if (typeof value === 'string') {
    return [{ value, path }];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectFlowStrings(item, `${path}.${index}`));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => collectFlowStrings(nested, `${path}.${key}`));
  }

  return [];
}

function readNodeAtPath(root: Record<string, FlowJsonValue>, path: string[]): unknown {
  let current: unknown = root;

  for (const segment of path) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      current = Number.isInteger(index) ? current[index] : undefined;
      continue;
    }

    current = asRecord(current)?.[segment];
  }

  return current;
}

function isFlowScopeType(type: string | undefined): boolean {
  return ['If', 'Scope', 'Switch', 'Foreach', 'Until'].includes(type ?? '');
}

function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return (left.path ?? '').localeCompare(right.path ?? '') || left.code.localeCompare(right.code) || left.message.localeCompare(right.message);
}

function scanFlowStrings(value: unknown, pattern: RegExp, register: (match: string) => void): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(pattern)) {
      if (match[1]) {
        register(match[1]);
      }
    }

    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      scanFlowStrings(item, pattern, register);
    }

    return;
  }

  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      scanFlowStrings(nested, pattern, register);
    }
  }
}

function renameConnectionReference(artifact: FlowArtifact, from: string, to: string): void {
  artifact.metadata.connectionReferences = artifact.metadata.connectionReferences.map((reference) =>
    reference.name === from || reference.connectionReferenceLogicalName === from
      ? {
          ...reference,
          ...(reference.name === from ? { name: to } : {}),
          ...(reference.connectionReferenceLogicalName === from ? { connectionReferenceLogicalName: to } : {}),
        }
      : reference
  );

  const parameters = asRecord(artifact.definition.parameters);
  const connections = asRecord(parameters?.['$connections']);
  const connectionValues = asRecord(connections?.value);

  if (connectionValues && connectionValues[from] !== undefined) {
    const value = connectionValues[from];
    delete connectionValues[from];
    connectionValues[to] = renameConnectionReferenceValue(value as FlowJsonValue, from, to);
  }

  artifact.definition = renameConnectionReferenceValue(artifact.definition, from, to) as FlowArtifact['definition'];
}

function validateFlowActionRenamePatch(
  artifact: FlowArtifact,
  renames: Record<string, string>
): Diagnostic | undefined {
  const entries = Object.entries(renames);

  if (entries.length === 0) {
    return undefined;
  }

  const actionNames = new Set(
    buildFlowIntermediateRepresentation(artifact).nodes.filter((node) => node.kind !== 'trigger').map((node) => node.name)
  );
  const sources = new Set(entries.map(([from]) => from));
  const seenTargets = new Map<string, string>();

  for (const [from, rawTo] of entries) {
    const to = rawTo.trim();

    if (!from || !to) {
      return createDiagnostic(
        'error',
        'FLOW_PATCH_ACTION_RENAME_INVALID',
        'Flow action rename patches require non-empty source and target action names.',
        {
          source: '@pp/flow',
        }
      );
    }

    if (!actionNames.has(from)) {
      return createDiagnostic(
        'error',
        'FLOW_PATCH_ACTION_SOURCE_MISSING',
        `Flow patch cannot rename missing action ${from}.`,
        {
          source: '@pp/flow',
        }
      );
    }

    if (from === to) {
      continue;
    }

    if (sources.has(to)) {
      return createDiagnostic(
        'error',
        'FLOW_PATCH_ACTION_RENAME_CHAIN_UNSUPPORTED',
        `Flow patch action rename ${from} -> ${to} is unsupported because ${to} is also a rename source.`,
        {
          source: '@pp/flow',
        }
      );
    }

    const existingSource = seenTargets.get(to);

    if (existingSource && existingSource !== from) {
      return createDiagnostic(
        'error',
        'FLOW_PATCH_ACTION_TARGET_CONFLICT',
        `Flow patch action rename target ${to} is requested by multiple source actions.`,
        {
          source: '@pp/flow',
        }
      );
    }

    seenTargets.set(to, from);

    if (actionNames.has(to)) {
      return createDiagnostic(
        'error',
        'FLOW_PATCH_ACTION_TARGET_EXISTS',
        `Flow patch cannot rename action ${from} to ${to} because ${to} already exists.`,
        {
          source: '@pp/flow',
        }
      );
    }
  }

  return undefined;
}

function validateFlowConnectionReferenceRenamePatch(
  artifact: FlowArtifact,
  renames: Record<string, string>
): Diagnostic | undefined {
  const entries = Object.entries(renames);

  if (entries.length === 0) {
    return undefined;
  }

  const connectionReferences = new Set([
    ...artifact.metadata.connectionReferences.flatMap((reference) =>
      [reference.name, reference.connectionReferenceLogicalName].filter((value): value is string => Boolean(value))
    ),
    ...Array.from(collectDefinitionConnectionReferences(artifact.definition).keys()),
  ]);
  const sources = new Set(entries.map(([from]) => from));
  const seenTargets = new Map<string, string>();

  for (const [from, rawTo] of entries) {
    const to = rawTo.trim();

    if (!from || !to) {
      return createDiagnostic(
        'error',
        'FLOW_PATCH_CONNECTION_REFERENCE_RENAME_INVALID',
        'Flow connection-reference rename patches require non-empty source and target names.',
        {
          source: '@pp/flow',
        }
      );
    }

    if (!connectionReferences.has(from)) {
      return createDiagnostic(
        'error',
        'FLOW_PATCH_CONNECTION_REFERENCE_SOURCE_MISSING',
        `Flow patch cannot rename missing connection reference ${from}.`,
        {
          source: '@pp/flow',
        }
      );
    }

    if (from === to) {
      continue;
    }

    if (sources.has(to)) {
      return createDiagnostic(
        'error',
        'FLOW_PATCH_CONNECTION_REFERENCE_RENAME_CHAIN_UNSUPPORTED',
        `Flow patch connection-reference rename ${from} -> ${to} is unsupported because ${to} is also a rename source.`,
        {
          source: '@pp/flow',
        }
      );
    }

    const existingSource = seenTargets.get(to);

    if (existingSource && existingSource !== from) {
      return createDiagnostic(
        'error',
        'FLOW_PATCH_CONNECTION_REFERENCE_TARGET_CONFLICT',
        `Flow patch connection-reference rename target ${to} is requested by multiple source references.`,
        {
          source: '@pp/flow',
        }
      );
    }

    seenTargets.set(to, from);

    if (connectionReferences.has(to)) {
      return createDiagnostic(
        'error',
        'FLOW_PATCH_CONNECTION_REFERENCE_TARGET_EXISTS',
        `Flow patch cannot rename connection reference ${from} to ${to} because ${to} already exists.`,
        {
          source: '@pp/flow',
        }
      );
    }
  }

  return undefined;
}

function validateFlowEnvironmentVariableRenamePatch(
  artifact: FlowArtifact,
  renames: Record<string, string>
): Diagnostic | undefined {
  const entries = Object.entries(renames);

  if (entries.length === 0) {
    return undefined;
  }

  const environmentVariables = new Set(artifact.metadata.environmentVariables);
  const sources = new Set(entries.map(([from]) => from));
  const seenTargets = new Map<string, string>();

  for (const [from, rawTo] of entries) {
    const to = rawTo.trim();

    if (!from || !to) {
      return createDiagnostic(
        'error',
        'FLOW_PATCH_ENVIRONMENT_VARIABLE_RENAME_INVALID',
        'Flow environment-variable rename patches require non-empty source and target names.',
        {
          source: '@pp/flow',
        }
      );
    }

    if (!environmentVariables.has(from)) {
      return createDiagnostic(
        'error',
        'FLOW_PATCH_ENVIRONMENT_VARIABLE_SOURCE_MISSING',
        `Flow patch cannot rename missing environment variable ${from}.`,
        {
          source: '@pp/flow',
        }
      );
    }

    if (from === to) {
      continue;
    }

    if (sources.has(to)) {
      return createDiagnostic(
        'error',
        'FLOW_PATCH_ENVIRONMENT_VARIABLE_RENAME_CHAIN_UNSUPPORTED',
        `Flow patch environment-variable rename ${from} -> ${to} is unsupported because ${to} is also a rename source.`,
        {
          source: '@pp/flow',
        }
      );
    }

    const existingSource = seenTargets.get(to);

    if (existingSource && existingSource !== from) {
      return createDiagnostic(
        'error',
        'FLOW_PATCH_ENVIRONMENT_VARIABLE_TARGET_CONFLICT',
        `Flow patch environment-variable rename target ${to} is requested by multiple source variables.`,
        {
          source: '@pp/flow',
        }
      );
    }

    seenTargets.set(to, from);

    if (environmentVariables.has(to)) {
      return createDiagnostic(
        'error',
        'FLOW_PATCH_ENVIRONMENT_VARIABLE_TARGET_EXISTS',
        `Flow patch cannot rename environment variable ${from} to ${to} because ${to} already exists.`,
        {
          source: '@pp/flow',
        }
      );
    }
  }

  return undefined;
}

function validateFlowVariableRenamePatch(
  artifact: FlowArtifact,
  renames: Record<string, string>
): Diagnostic | undefined {
  const entries = Object.entries(renames);

  if (entries.length === 0) {
    return undefined;
  }

  const variableNames = new Set(
    buildFlowIntermediateRepresentation(artifact).nodes.flatMap((node) => node.variableUsage.initializes)
  );
  const sources = new Set(entries.map(([from]) => from));
  const seenTargets = new Map<string, string>();

  for (const [from, rawTo] of entries) {
    const to = rawTo.trim();

    if (!from || !to) {
      return createDiagnostic(
        'error',
        'FLOW_PATCH_VARIABLE_RENAME_INVALID',
        'Flow variable rename patches require non-empty source and target variable names.',
        {
          source: '@pp/flow',
        }
      );
    }

    if (!variableNames.has(from)) {
      return createDiagnostic(
        'error',
        'FLOW_PATCH_VARIABLE_SOURCE_MISSING',
        `Flow patch cannot rename missing variable ${from}.`,
        {
          source: '@pp/flow',
        }
      );
    }

    if (from === to) {
      continue;
    }

    if (sources.has(to)) {
      return createDiagnostic(
        'error',
        'FLOW_PATCH_VARIABLE_RENAME_CHAIN_UNSUPPORTED',
        `Flow patch variable rename ${from} -> ${to} is unsupported because ${to} is also a rename source.`,
        {
          source: '@pp/flow',
        }
      );
    }

    const existingSource = seenTargets.get(to);

    if (existingSource && existingSource !== from) {
      return createDiagnostic(
        'error',
        'FLOW_PATCH_VARIABLE_TARGET_CONFLICT',
        `Flow patch variable rename target ${to} is requested by multiple source variables.`,
        {
          source: '@pp/flow',
        }
      );
    }

    seenTargets.set(to, from);

    if (variableNames.has(to)) {
      return createDiagnostic(
        'error',
        'FLOW_PATCH_VARIABLE_TARGET_EXISTS',
        `Flow patch cannot rename variable ${from} to ${to} because ${to} already exists.`,
        {
          source: '@pp/flow',
        }
      );
    }
  }

  return undefined;
}

function renameAction(artifact: FlowArtifact, from: string, to: string): void {
  artifact.definition = renameActionValue(artifact.definition, from, to) as FlowArtifact['definition'];
}

function renameVariable(artifact: FlowArtifact, from: string, to: string): void {
  artifact.definition = renameVariableValue(artifact.definition, from, to) as FlowArtifact['definition'];
}

function renameEnvironmentVariable(artifact: FlowArtifact, from: string, to: string): void {
  artifact.metadata.environmentVariables = Array.from(
    new Set(artifact.metadata.environmentVariables.map((name) => (name === from ? to : name)))
  ).sort((left, right) => left.localeCompare(right));
  artifact.definition = renameEnvironmentVariableValue(artifact.definition, from, to) as FlowArtifact['definition'];
}

function renameConnectionReferenceValue(value: FlowJsonValue, from: string, to: string): FlowJsonValue {
  if (typeof value === 'string') {
    return value.replace(
      new RegExp(`\\bparameters\\(\\s*(['"])\\$connections\\1\\s*\\)\\s*\\[\\s*(['"])${escapeRegExp(from)}\\2\\s*\\]`, 'g'),
      (_match, quote: string, keyQuote: string) => `parameters(${quote}$connections${quote})[${keyQuote}${to}${keyQuote}]`
    );
  }

  if (Array.isArray(value)) {
    return value.map((item) => renameConnectionReferenceValue(item, from, to));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => {
        if (
          ['name', 'connectionReferenceLogicalName', 'connectionreferencelogicalname', 'logicalName'].includes(key) &&
          nested === from
        ) {
          return [key, to];
        }

        return [key, renameConnectionReferenceValue(nested, from, to)];
      })
    );
  }

  return value;
}

function renameEnvironmentVariableValue(value: FlowJsonValue, from: string, to: string): FlowJsonValue {
  if (typeof value === 'string') {
    return value.replace(
      new RegExp(`\\benvironmentVariables\\(\\s*(['"])${escapeRegExp(from)}\\1\\s*\\)`, 'g'),
      (_match, quote: string) => `environmentVariables(${quote}${to}${quote})`
    );
  }

  if (Array.isArray(value)) {
    return value.map((item) => renameEnvironmentVariableValue(item, from, to));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, renameEnvironmentVariableValue(nested as FlowJsonValue, from, to)])
    ) as FlowJsonValue;
  }

  return value;
}

function renameVariableValue(value: FlowJsonValue, from: string, to: string): FlowJsonValue {
  if (typeof value === 'string') {
    return value.replace(new RegExp(`\\bvariables\\(\\s*(['"])${escapeRegExp(from)}\\1\\s*\\)`, 'g'), (_match, quote: string) =>
      `variables(${quote}${to}${quote})`
    );
  }

  if (Array.isArray(value)) {
    return value.map((item) => renameVariableValue(item, from, to));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => {
        if (key === 'name' && nested === from) {
          return [key, to];
        }

        return [key, renameVariableValue(nested as FlowJsonValue, from, to)];
      })
    ) as FlowJsonValue;
  }

  return value;
}

function renameActionValue(value: FlowJsonValue, from: string, to: string): FlowJsonValue {
  if (typeof value === 'string') {
    return renameActionReferencesInString(value, from, to);
  }

  if (Array.isArray(value)) {
    return value.map((item) => renameActionValue(item, from, to));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => {
        if (key === 'actions') {
          return [key, renameActionMap(asRecord(nested), from, to)];
        }

        if (key === 'runAfter') {
          return [key, renameRunAfterMap(asRecord(nested), from, to)];
        }

        return [key, renameActionValue(nested as FlowJsonValue, from, to)];
      })
    ) as FlowJsonValue;
  }

  return value;
}

function renameActionMap(
  record: Record<string, unknown> | undefined,
  from: string,
  to: string
): Record<string, FlowJsonValue> | undefined {
  if (!record) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, nested]) => [key === from ? to : key, renameActionValue(nested as FlowJsonValue, from, to)])
  ) as Record<string, FlowJsonValue>;
}

function renameRunAfterMap(
  record: Record<string, unknown> | undefined,
  from: string,
  to: string
): Record<string, FlowJsonValue> | undefined {
  if (!record) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, nested]) => [key === from ? to : key, normalizeFlowJsonValue(nested)])
  ) as Record<string, FlowJsonValue>;
}

function renameActionReferencesInString(value: string, from: string, to: string): string {
  const escapedFrom = escapeRegExp(from);
  return value.replace(
    new RegExp(`\\b(actions|body|outputs)\\(\\s*(['"])${escapedFrom}\\2\\s*\\)`, 'g'),
    (_match, fnName: string, quote: string) => `${fnName}(${quote}${to}${quote})`
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function setFlowPathValue(root: Record<string, FlowJsonValue>, path: string[], value: FlowJsonValue): void {
  let current: FlowJsonValue = root;

  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index] as string;
    const nextSegment = path[index + 1];

    if (Array.isArray(current)) {
      const arrayIndex = Number(segment);

      if (!Number.isInteger(arrayIndex)) {
        return;
      }

      current[arrayIndex] ??= typeof nextSegment === 'string' && Number.isInteger(Number(nextSegment)) ? [] : {};
      current = current[arrayIndex] as FlowJsonValue;
      continue;
    }

    if (typeof current === 'object' && current !== null) {
      const record = current as Record<string, FlowJsonValue>;
      record[segment] ??= Number.isInteger(Number(nextSegment)) ? [] : {};
      current = record[segment] as FlowJsonValue;
      continue;
    }

    return;
  }

  const finalSegment = path[path.length - 1];

  if (finalSegment === undefined) {
    return;
  }

  if (Array.isArray(current)) {
    const arrayIndex = Number(finalSegment);

    if (Number.isInteger(arrayIndex)) {
      current[arrayIndex] = value;
    }

    return;
  }

  if (typeof current === 'object' && current !== null) {
    (current as Record<string, FlowJsonValue>)[finalSegment] = value;
  }
}

function mergeDiagnosticLists(...lists: Array<Diagnostic[] | undefined>): Diagnostic[] {
  return lists.flatMap((list) => list ?? []);
}
