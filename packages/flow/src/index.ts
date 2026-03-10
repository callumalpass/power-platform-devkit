import { mkdir, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { readJsonFile, sha256Hex, stableStringify, writeJsonFile } from '@pp/artifacts';
import {
  ConnectionReferenceService,
  EnvironmentVariableService,
  type DataverseClient,
  type ConnectionReferenceValidationResult,
  type EnvironmentVariableSummary,
} from '@pp/dataverse';
import { createDiagnostic, fail, ok, type Diagnostic, type OperationResult } from '@pp/diagnostics';
import { SolutionService } from '@pp/solution';
import {
  normalizeConnectorApiId,
  resolveFlowSupportedConnectorOperation,
  type FlowSupportedConnectorOperationParameter,
} from './connector-operation-registry';

export type FlowJsonValue = null | boolean | number | string | FlowJsonValue[] | { [key: string]: FlowJsonValue };

export interface FlowRecord {
  workflowid: string;
  name?: string;
  category?: number;
  statecode?: number;
  statuscode?: number;
  uniquename?: string;
  clientdata?: string;
}

export interface FlowConnectionReference {
  name: string;
  connectionReferenceLogicalName?: string;
  connectionId?: string;
  apiId?: string;
}

export interface FlowSummary {
  id: string;
  name?: string;
  uniqueName?: string;
  category?: number;
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

export interface FlowArtifact {
  schemaVersion: 1;
  kind: 'pp.flow.artifact';
  metadata: {
    id?: string;
    name?: string;
    displayName?: string;
    uniqueName?: string;
    stateCode?: number;
    statusCode?: number;
    sourcePath?: string;
    connectionReferences: FlowConnectionReference[];
    parameters: Record<string, FlowJsonValue>;
    environmentVariables: string[];
  };
  definition: Record<string, FlowJsonValue>;
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

export interface FlowPatchResult {
  path: string;
  outPath: string;
  changed: boolean;
  appliedOperations: string[];
  summary: FlowArtifactSummary;
}

export interface FlowRunRecord {
  flowrunid?: string;
  name?: string;
  workflowid?: string;
  workflowname?: string;
  status?: string;
  starttime?: string;
  endtime?: string;
  durationinms?: number;
  retrycount?: number;
  errorcode?: string;
  errormessage?: string;
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
}

export interface FlowErrorGroup {
  group: string;
  count: number;
  latestRunId?: string;
  latestStatus?: string;
  sampleErrorCode?: string;
  sampleErrorMessage?: string;
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

export interface FlowDoctorReport {
  flow?: FlowInspectResult;
  recentRuns: {
    total: number;
    failed: number;
    latestFailure?: FlowRunSummary;
  };
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

const NOISY_FLOW_KEYS = new Set([
  'createdTime',
  'lastModifiedTime',
  'changedTime',
  'lastModifiedBy',
  'creator',
  'owners',
]);

export class FlowService {
  constructor(private readonly dataverseClient?: DataverseClient) {}

  async list(options: { solutionUniqueName?: string } = {}): Promise<OperationResult<FlowSummary[]>> {
    if (!this.dataverseClient) {
      return fail(
        createDiagnostic('error', 'FLOW_DATAVERSE_CLIENT_REQUIRED', 'Dataverse client is required for remote flow listing.', {
          source: '@pp/flow',
        })
      );
    }

    const workflows = await this.dataverseClient.queryAll<FlowRecord>({
      table: 'workflows',
      select: ['workflowid', 'name', 'category', 'statecode', 'statuscode', 'uniquename', 'clientdata'],
      filter: 'category eq 5',
    });

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

    const records = (workflows.data ?? [])
      .filter((record) => !allowedIds || allowedIds.has(record.workflowid))
      .map((record) => normalizeRemoteFlow(record));

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

  async runs(
    identifier: string,
    options: {
      solutionUniqueName?: string;
      status?: string;
      since?: string;
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
        knownLimitations: [
          'Flow runtime diagnostics require FlowRun ingestion to be available in the target environment.',
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

    const runs = await this.dataverseClient.queryAll<FlowRunRecord>({
      table: 'flowruns',
      select: ['flowrunid', 'name', 'workflowid', 'workflowname', 'status', 'starttime', 'endtime', 'durationinms', 'retrycount', 'errorcode', 'errormessage'],
    });

    if (!runs.success) {
      return runs as unknown as OperationResult<FlowRunSummary[]>;
    }

    const remoteFlow = flow.data;
    const filtered = (runs.data ?? [])
      .filter((run) => matchesFlowRun(run, remoteFlow))
      .filter((run) => !options.status || normalizeStatus(run.status) === normalizeStatus(options.status))
      .filter((run) => !options.since || isAfterRelativeTime(run.starttime, options.since))
      .map(normalizeFlowRun)
      .sort(compareRunsDescending);

    return ok(filtered, {
      supportTier: 'experimental',
      diagnostics: [...flow.diagnostics, ...runs.diagnostics],
      warnings: [...flow.warnings, ...runs.warnings],
      knownLimitations: [
        'FlowRun data may be delayed or incomplete depending on ingestion and retention settings.',
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
    const groups = new Map<string, FlowErrorGroup>();

    for (const run of runs.data ?? []) {
      const group = resolveFlowErrorGroup(run, flow.data, groupBy);
      const existing = groups.get(group);

      if (existing) {
        existing.count += 1;
        continue;
      }

      groups.set(group, {
        group,
        count: 1,
        latestRunId: run.id,
        latestStatus: run.status,
        sampleErrorCode: run.errorCode,
        sampleErrorMessage: run.errorMessage,
      });
    }

    return ok(Array.from(groups.values()).sort((left, right) => right.count - left.count || left.group.localeCompare(right.group)), {
      supportTier: 'experimental',
      diagnostics: runs.diagnostics,
      warnings: runs.warnings,
    });
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
    const findings = [
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
        knownLimitations: [
          'Runtime diagnostics depend on FlowRun ingestion and may lag behind portal data.',
          'Connector-level grouping is heuristic until richer runtime fields are available.',
        ],
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

export async function validateFlowArtifact(path: string): Promise<OperationResult<FlowValidationReport>> {
  const artifact = await loadFlowArtifact(path);

  if (!artifact.success || !artifact.data) {
    return artifact as unknown as OperationResult<FlowValidationReport>;
  }

  const diagnostics: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  const seenConnrefs = new Set<string>();

  if (!artifact.data.metadata.name && !artifact.data.metadata.displayName) {
    diagnostics.push(
      createDiagnostic('error', 'FLOW_ARTIFACT_NAME_MISSING', `Flow artifact ${path} does not define a name or displayName.`, {
        source: '@pp/flow',
      })
    );
  }

  if (Object.keys(artifact.data.definition).length === 0) {
    diagnostics.push(
      createDiagnostic('error', 'FLOW_DEFINITION_MISSING', `Flow artifact ${path} does not include a definition payload.`, {
        source: '@pp/flow',
      })
    );
  }

  const semantic = analyzeFlowSemantics(artifact.data, path);
  diagnostics.push(...semantic.diagnostics);
  warnings.push(...semantic.warnings);

  for (const reference of artifact.data.metadata.connectionReferences) {
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
      name: artifact.data.metadata.displayName ?? artifact.data.metadata.name,
      connectionReferences: artifact.data.metadata.connectionReferences,
      parameters: Object.keys(artifact.data.metadata.parameters).sort(),
      environmentVariables: artifact.data.metadata.environmentVariables,
      intermediateRepresentation: semantic.intermediateRepresentation,
      semanticSummary: semantic.summary,
    },
    {
      supportTier: 'preview',
      diagnostics,
      warnings: [...artifact.warnings, ...warnings],
    }
  );
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

function normalizeRemoteFlow(record: FlowRecord): FlowInspectResult {
  const parsed = parseFlowClientData(record.clientdata);

  return {
    id: record.workflowid,
    name: record.name,
    uniqueName: record.uniquename,
    category: record.category,
    stateCode: record.statecode,
    statusCode: record.statuscode,
    definitionAvailable: parsed.definition !== undefined,
    connectionReferences: parsed.connectionReferences,
    parameters: parsed.parameters,
    environmentVariables: parsed.environmentVariables,
    clientData: parsed.clientData,
  };
}

function normalizeFlowRun(record: FlowRunRecord): FlowRunSummary {
  return {
    id: record.flowrunid ?? record.name ?? 'unknown-run',
    workflowId: record.workflowid,
    workflowName: record.workflowname,
    status: record.status,
    startTime: record.starttime,
    endTime: record.endtime,
    durationMs: record.durationinms,
    retryCount: record.retrycount,
    errorCode: record.errorcode,
    errorMessage: record.errormessage,
  };
}

function matchesFlowRun(record: FlowRunRecord, flow: FlowInspectResult): boolean {
  return record.workflowid === flow.id || record.workflowname === flow.name || record.workflowname === flow.uniqueName;
}

function normalizeStatus(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function compareRunsDescending(left: FlowRunSummary, right: FlowRunSummary): number {
  return (right.startTime ?? '').localeCompare(left.startTime ?? '');
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
        uniqueName: readString(metadata.uniqueName),
        stateCode: readNumber(metadata.stateCode),
        statusCode: readNumber(metadata.statusCode),
        sourcePath: readString(metadata.sourcePath) ?? sourcePath,
        connectionReferences,
        parameters,
        environmentVariables,
      },
      definition: stripNoisyFlowValue(normalizeFlowJsonRecord(definition)) as Record<string, FlowJsonValue>,
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
        uniqueName: readString(record.uniquename) ?? readString(properties.uniquename),
        stateCode: readNumber(record.statecode) ?? readNumber(properties.statecode),
        statusCode: readNumber(record.statuscode) ?? readNumber(properties.statuscode),
        sourcePath,
        connectionReferences: parsed.connectionReferences,
        parameters,
        environmentVariables: parsed.environmentVariables,
      },
      definition: stripNoisyFlowValue(normalizeFlowJsonRecord(definition)) as Record<string, FlowJsonValue>,
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

function buildRawFlowArtifactDocument(artifact: FlowArtifact): Record<string, FlowJsonValue> {
  const record: Record<string, FlowJsonValue> = {
    ...(artifact.unknown ? cloneJsonValue(artifact.unknown) : {}),
    properties: {
      definition: cloneJsonValue(artifact.definition),
      ...(artifact.metadata.displayName ? { displayName: artifact.metadata.displayName } : {}),
      ...(artifact.metadata.name ? { name: artifact.metadata.name } : {}),
      ...(artifact.metadata.uniqueName ? { uniquename: artifact.metadata.uniqueName } : {}),
      ...(artifact.metadata.stateCode !== undefined ? { statecode: artifact.metadata.stateCode } : {}),
      ...(artifact.metadata.statusCode !== undefined ? { statuscode: artifact.metadata.statusCode } : {}),
    },
  };

  if (artifact.metadata.id) {
    record.id = artifact.metadata.id;
  }

  return record;
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
  const connectionName = readString(connection?.name);

  return {
    apiId: readString(host?.apiId) ?? readString(asRecord(host?.api)?.id),
    operationId: readString(inputs?.operationId) ?? readString(record?.operationId),
    connectionReferenceName: extractConnectionReferenceName(connectionName),
    connectionPath: connectionName ? `definition.${nodePath}.inputs.host.connection.name` : undefined,
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

  return match?.[1];
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
    reference.name === from ? { ...reference, name: to, connectionReferenceLogicalName: to } : reference
  );

  const parameters = asRecord(artifact.definition.parameters);
  const connections = asRecord(parameters?.['$connections']);
  const connectionValues = asRecord(connections?.value);

  if (connectionValues && connectionValues[from] !== undefined) {
    const value = connectionValues[from];
    delete connectionValues[from];
    connectionValues[to] = renameConnectionReferenceValue(value as FlowJsonValue, from, to);
  }
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

function renameAction(artifact: FlowArtifact, from: string, to: string): void {
  artifact.definition = renameActionValue(artifact.definition, from, to) as FlowArtifact['definition'];
}

function renameEnvironmentVariable(artifact: FlowArtifact, from: string, to: string): void {
  artifact.metadata.environmentVariables = Array.from(
    new Set(artifact.metadata.environmentVariables.map((name) => (name === from ? to : name)))
  ).sort((left, right) => left.localeCompare(right));
  artifact.definition = renameEnvironmentVariableValue(artifact.definition, from, to) as FlowArtifact['definition'];
}

function renameConnectionReferenceValue(value: FlowJsonValue, from: string, to: string): FlowJsonValue {
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
    return value.replaceAll(`environmentVariables('${from}')`, `environmentVariables('${to}')`);
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

function parseFlowPath(pathExpression: string): string[] {
  return pathExpression
    .split('.')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function resolveFlowOutputPath(path: string): string {
  const resolved = resolve(path);
  return resolved.endsWith('.json') ? resolved : resolve(resolved, 'flow.json');
}

function stripNoisyFlowValue(value: FlowJsonValue): FlowJsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => stripNoisyFlowValue(item));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !NOISY_FLOW_KEYS.has(key))
        .map(([key, nested]) => [key, stripNoisyFlowValue(nested)])
    );
  }

  return value;
}

function normalizeFlowJsonRecord(record: Record<string, unknown>): Record<string, FlowJsonValue> {
  return Object.fromEntries(Object.entries(record).map(([key, nested]) => [key, normalizeFlowJsonValue(nested)]));
}

function normalizeFlowJsonValue(value: unknown): FlowJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeFlowJsonValue(item));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, normalizeFlowJsonValue(nested)])
    );
  }

  return String(value);
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
