import { resolve as resolvePath } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { ParameterMapping } from '@pp/config';
import { AuthService, createTokenProvider } from '@pp/auth';
import { ConnectionReferenceService, EnvironmentVariableService, resolveDataverseClient } from '@pp/dataverse';
import { createDiagnostic, fail, ok, type Diagnostic, type OperationResult } from '@pp/diagnostics';
import { loadFlowArtifact, patchFlowArtifact, validateFlowArtifact, type FlowArtifact, type FlowValidationReport } from '@pp/flow';
import { HttpClient } from '@pp/http';
import {
  discoverProject,
  resolvePowerBiTarget,
  resolveSharePointTarget,
  summarizeResolvedParameter,
  type ProjectContext,
  type ResolvedProjectParameter,
} from '@pp/project';
import { PowerBiClient } from '@pp/powerbi';
import { SharePointClient } from '@pp/sharepoint';
import { SolutionService } from '@pp/solution';
import type {
  ConnectionReferenceCreateOptions,
  ConnectionReferenceSummary,
  EnvironmentVariableCreateOptions,
  EnvironmentVariableSummary,
} from '@pp/dataverse';

export interface DeployInput {
  name: string;
  value?: string | number | boolean;
  source: ResolvedProjectParameter['source'];
  hasValue: boolean;
  sensitive: boolean;
  reference?: string;
  mappings: Array<{ kind: string; target: string }>;
}

export type DeployExecutionStage = 'resolve' | 'preflight' | 'plan' | 'apply' | 'report';
export type DeployExecutionMode = 'apply' | 'dry-run' | 'plan';

export interface DeployTarget {
  stage?: string;
  environmentAlias?: string;
  solutionAlias?: string;
  solutionUniqueName?: string;
}

interface DeployOperationPlanBase {
  parameter: string;
  source: ResolvedProjectParameter['source'];
  sensitive: boolean;
  environmentAlias?: string;
  solutionAlias?: string;
  solutionUniqueName?: string;
  target: string;
  valuePreview?: string | number | boolean;
}

export interface DataverseEnvvarDeployOperationPlan extends DeployOperationPlanBase {
  kind: 'dataverse-envvar-set';
}

export interface DataverseEnvvarUpsertDeployOperationPlan extends DeployOperationPlanBase {
  kind: 'dataverse-envvar-upsert';
  createOptions?: DeployEnvironmentVariableCreateOptions;
}

export interface DataverseConnectionReferenceDeployOperationPlan extends DeployOperationPlanBase {
  kind: 'dataverse-connref-set';
}

export interface DataverseConnectionReferenceUpsertDeployOperationPlan extends DeployOperationPlanBase {
  kind: 'dataverse-connref-upsert';
  createOptions?: DeployConnectionReferenceCreateOptions;
}

export interface DeployInputBindingOperationPlan extends DeployOperationPlanBase {
  kind: 'deploy-input-bind';
}

export interface DeploySecretBindingOperationPlan extends DeployOperationPlanBase {
  kind: 'deploy-secret-bind';
}

export interface FlowParameterDeployOperationPlan extends DeployOperationPlanBase {
  kind: 'flow-parameter-set';
  path: string;
}

export interface FlowConnectionReferenceDeployOperationPlan extends DeployOperationPlanBase {
  kind: 'flow-connref-set';
  path: string;
}

export interface FlowEnvironmentVariableDeployOperationPlan extends DeployOperationPlanBase {
  kind: 'flow-envvar-set';
  path: string;
}

export interface SharePointFileTextDeployOperationPlan extends DeployOperationPlanBase {
  kind: 'sharepoint-file-text-set';
  authProfile: string;
  bindingName?: string;
  site: string;
  drive?: string;
  file: string;
}

export interface PowerBiDatasetRefreshDeployOperationPlan extends DeployOperationPlanBase {
  kind: 'powerbi-dataset-refresh';
  authProfile: string;
  bindingName?: string;
  workspace: string;
  dataset: string;
  notifyOption?: string;
  refreshType?: string;
}

export type DeployOperationPlan =
  | DataverseEnvvarDeployOperationPlan
  | DataverseEnvvarUpsertDeployOperationPlan
  | DataverseConnectionReferenceDeployOperationPlan
  | DataverseConnectionReferenceUpsertDeployOperationPlan
  | DeployInputBindingOperationPlan
  | DeploySecretBindingOperationPlan
  | FlowParameterDeployOperationPlan
  | FlowConnectionReferenceDeployOperationPlan
  | FlowEnvironmentVariableDeployOperationPlan
  | SharePointFileTextDeployOperationPlan
  | PowerBiDatasetRefreshDeployOperationPlan;

export interface DeployPlan {
  projectRoot: string;
  generatedAt: string;
  executionStages: DeployExecutionStage[];
  supportedAdapters: string[];
  defaultEnvironment?: string;
  defaultSolution?: string;
  selectedStage?: string;
  activeEnvironment?: string;
  activeSolution?: string;
  target: DeployTarget;
  inputs: DeployInput[];
  providerBindings: string[];
  topology: Array<{
    name: string;
    environment?: string;
    defaultSolution?: string;
  }>;
  templateRegistries: string[];
  build: Record<string, unknown>;
  assets: Array<{
    name: string;
    path: string;
    kind: string;
    exists: boolean;
  }>;
  bindings: DeployBindingSummary;
  operations: DeployOperationPlan[];
}

export interface DeployPreflightCheck {
  status: 'pass' | 'warn' | 'fail';
  code: string;
  message: string;
  target?: string;
  details?: Record<string, unknown>;
}

export interface DeployPreflightSummary {
  ok: boolean;
  checks: DeployPreflightCheck[];
}

export type DeployOperationResult = DeployOperationPlan & {
  status: 'planned' | 'resolved' | 'applied' | 'skipped' | 'failed';
  targetExists?: boolean;
  currentValue?: string;
  nextValue?: string;
  changed?: boolean;
  created?: boolean;
  message?: string;
};

export interface DeployApplySummary {
  attempted: number;
  applied: number;
  created: number;
  failed: number;
  skipped: number;
  changed: number;
  resolved: number;
}

export interface DeployConfirmation {
  required: boolean;
  confirmed: boolean;
  status: 'not-required' | 'confirmed' | 'blocked';
}

export interface DeployBindingSummaryEntry {
  kind: 'deploy-input' | 'deploy-secret';
  parameter: string;
  source: ResolvedProjectParameter['source'];
  sensitive: boolean;
  target: string;
  status: 'resolved' | 'missing' | 'conflict';
  reference?: string;
  valuePreview?: string | number | boolean;
}

export interface DeployBindingSummary {
  inputs: DeployBindingSummaryEntry[];
  secrets: DeployBindingSummaryEntry[];
}

export interface DeployEnvironmentVariableCreateOptions {
  displayName?: string;
  defaultValue?: string;
  type?: string | number;
  valueSchema?: string;
  secretStore?: number;
}

export interface DeployConnectionReferenceCreateOptions {
  displayName?: string;
  connectorId?: string;
  customConnectorId?: string;
}

interface DeployMetadataMismatch {
  mismatchedFields: string[];
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
}

export interface ResolvedDeployBindingEntry extends DeployBindingSummaryEntry {
  value?: string | number | boolean;
}

interface DeployTargetConflict {
  code:
    | 'DEPLOY_PREFLIGHT_ENVVAR_TARGET_CONFLICT'
    | 'DEPLOY_PREFLIGHT_CONNREF_TARGET_CONFLICT'
    | 'DEPLOY_PREFLIGHT_BINDING_TARGET_CONFLICT'
    | 'DEPLOY_PREFLIGHT_FLOW_PARAMETER_TARGET_CONFLICT'
    | 'DEPLOY_PREFLIGHT_FLOW_CONNREF_TARGET_CONFLICT'
    | 'DEPLOY_PREFLIGHT_FLOW_ENVVAR_TARGET_CONFLICT'
    | 'DEPLOY_PREFLIGHT_SHAREPOINT_TARGET_CONFLICT'
    | 'DEPLOY_PREFLIGHT_POWERBI_TARGET_CONFLICT';
  message: string;
  details: {
    target: string;
    parameters: string[];
    operationKinds: DeployOperationPlan['kind'][];
  };
}

export interface ResolvedDeployBindings {
  inputs: ResolvedDeployBindingEntry[];
  secrets: ResolvedDeployBindingEntry[];
}

type DeployPrimitiveValue = string | number | boolean;

interface FlowParameterDeployTargetInspection {
  operation: PreparedDeployOperation & { plan: FlowParameterDeployOperationPlan; value: DeployPrimitiveValue };
  currentValue?: FlowArtifact['metadata']['parameters'][string];
}

interface FlowConnectionReferenceDeployTargetInspection {
  operation: PreparedDeployOperation & { plan: FlowConnectionReferenceDeployOperationPlan; value: DeployPrimitiveValue };
  currentValue?: string;
}

interface FlowEnvironmentVariableDeployTargetInspection {
  operation: PreparedDeployOperation & { plan: FlowEnvironmentVariableDeployOperationPlan; value: DeployPrimitiveValue };
  currentValue?: string;
}

interface DeploySolutionTargetInspection {
  environmentAlias: string;
  solutionUniqueName: string;
  checks: DeployPreflightCheck[];
  diagnostics: Diagnostic[];
  warnings: Diagnostic[];
  solutionFound: boolean;
  solutionAnalysis?: Awaited<ReturnType<SolutionService['analyze']>>['data'];
  references: ConnectionReferenceSummary[];
  variables: EnvironmentVariableSummary[];
  referenceByLogicalName: Map<string, ConnectionReferenceSummary>;
  variableBySchema: Map<string, EnvironmentVariableSummary>;
}

interface PreparedDeployOperation {
  plan: DeployOperationPlan;
  value?: DeployPrimitiveValue;
  executable: boolean;
  blockedCode?: 'DEPLOY_PREFLIGHT_PLAN_OPERATION_VALUE_MISSING' | 'DEPLOY_PREFLIGHT_PLAN_OPERATION_VALUE_REDACTED';
  blockedMessage?: string;
}

type PreparedSharePointFileTextOperation = PreparedDeployOperation & {
  plan: SharePointFileTextDeployOperationPlan;
  value?: DeployPrimitiveValue;
};

type PreparedPowerBiDatasetRefreshOperation = PreparedDeployOperation & {
  plan: PowerBiDatasetRefreshDeployOperationPlan;
  value?: DeployPrimitiveValue;
};

function isPreparedFlowParameterOperation(
  operation: PreparedDeployOperation
): operation is PreparedDeployOperation & { plan: FlowParameterDeployOperationPlan; value?: DeployPrimitiveValue } {
  return isFlowParameterOperation(operation.plan);
}

function isPreparedFlowConnectionReferenceOperation(
  operation: PreparedDeployOperation
): operation is PreparedDeployOperation & { plan: FlowConnectionReferenceDeployOperationPlan; value?: DeployPrimitiveValue } {
  return isFlowConnectionReferenceOperation(operation.plan);
}

function isPreparedFlowEnvironmentVariableOperation(
  operation: PreparedDeployOperation
): operation is PreparedDeployOperation & { plan: FlowEnvironmentVariableDeployOperationPlan; value?: DeployPrimitiveValue } {
  return isFlowEnvironmentVariableOperation(operation.plan);
}

interface ResolvedDeployMappingTarget {
  environmentAlias?: string;
  solutionAlias?: string;
  solutionUniqueName?: string;
}

const SUPPORTED_ENVIRONMENT_VARIABLE_TYPE_ALIASES = new Set([
  '100000000',
  'string',
  'text',
  '100000001',
  'number',
  'decimal',
  '100000002',
  'boolean',
  'bool',
  'two-options',
  'yes-no',
  '100000003',
  'json',
  '100000004',
  'data-source',
  'datasource',
  '100000005',
  'secret',
]);

export interface DeployExecutionResult {
  mode: DeployExecutionMode;
  target: DeployTarget;
  plan: DeployPlan;
  bindings: DeployBindingSummary;
  confirmation: DeployConfirmation;
  preflight: DeployPreflightSummary;
  apply: {
    summary: DeployApplySummary;
    operations: DeployOperationResult[];
  };
  report: {
    startedAt: string;
    finishedAt: string;
    durationMs: number;
  };
}

interface ComparableDeployPlan {
  executionStages: DeployExecutionStage[];
  supportedAdapters: string[];
  defaultEnvironment?: string;
  defaultSolution?: string;
  selectedStage?: string;
  activeEnvironment?: string;
  activeSolution?: string;
  target: DeployTarget;
  inputs: DeployInput[];
  providerBindings: string[];
  topology: DeployPlan['topology'];
  templateRegistries: string[];
  build: Record<string, unknown>;
  bindings: DeployBindingSummary;
  operations: DeployOperationPlan[];
}

export function buildDeployPlan(project: ProjectContext): OperationResult<DeployPlan> {
  const bindings = summarizeResolvedDeployBindings(resolveDeployBindings(project));
  const inputs = Object.values(project.parameters).map((parameter) => {
    const summary = summarizeResolvedParameter(parameter);
    return {
      name: summary.name,
      value: summary.value,
      source: summary.source,
      hasValue: summary.hasValue,
      sensitive: summary.sensitive,
      reference: summary.reference,
      mappings: summary.mappings,
    };
  });
  const operations = collectDeployOperations(project).map(({ plan }) => plan);
  const diagnostics: Diagnostic[] = [
    ...collectStaticMappingChecks(project).map((check) =>
      createDiagnostic('error', check.code, check.message, {
        source: '@pp/deploy',
        ...check.details,
      })
    ),
    ...collectProviderOperationDiagnostics(project),
  ];
  const dataverseOperations = operations.filter(isDataverseMutationOperation);

  if (dataverseOperations.some((operation) => !resolveOperationEnvironmentAlias(operation, project.topology.activeEnvironment))) {
    diagnostics.push(
      createDiagnostic('error', 'DEPLOY_TARGET_ENVIRONMENT_MISSING', 'Deploy target environment is not resolved from the project topology.', {
        source: '@pp/deploy',
      })
    );
  }

  if (dataverseOperations.some((operation) => !resolveOperationSolutionUniqueName(operation, project.topology.activeSolution?.uniqueName))) {
    diagnostics.push(
      createDiagnostic('error', 'DEPLOY_TARGET_SOLUTION_MISSING', 'Deploy target solution is not resolved from the project topology.', {
        source: '@pp/deploy',
      })
    );
  }

  return ok(
    {
      projectRoot: project.root,
      generatedAt: new Date().toISOString(),
      executionStages: ['resolve', 'preflight', 'plan', 'apply', 'report'],
      supportedAdapters: ['github-actions', 'azure-devops', 'power-platform-pipelines'],
      defaultEnvironment: project.config.defaults?.environment,
      defaultSolution: project.config.defaults?.solution,
      selectedStage: project.topology.selectedStage,
      activeEnvironment: project.topology.activeEnvironment,
      activeSolution: project.topology.activeSolution?.uniqueName,
      target: {
        stage: project.topology.selectedStage,
        environmentAlias: project.topology.activeEnvironment,
        solutionAlias: project.topology.activeSolution?.alias,
        solutionUniqueName: project.topology.activeSolution?.uniqueName,
      },
      inputs,
      providerBindings: Object.keys(project.providerBindings),
      topology: Object.values(project.topology.stages).map((stage) => ({
        name: stage.name,
        environment: stage.environment,
        defaultSolution: stage.defaultSolution?.uniqueName,
      })),
      templateRegistries: project.templateRegistries,
      build: project.build,
      assets: project.assets.map((asset) => ({
        name: asset.name,
        path: asset.path,
        kind: asset.kind,
        exists: asset.exists,
      })),
      bindings,
      operations,
    },
    {
      supportTier: 'preview',
      diagnostics,
    }
  );
}

export async function executeDeploy(
  project: ProjectContext,
  options: {
    mode?: DeployExecutionMode;
    confirmed?: boolean;
    expectedPlan?: DeployPlan;
  } = {}
): Promise<OperationResult<DeployExecutionResult>> {
  const startedAt = Date.now();
  const planResult = buildDeployPlan(project);
  const resolvedBindings = resolveDeployBindings(project);
  const bindingSummary = summarizeResolvedDeployBindings(resolvedBindings);
  const mode = options.mode ?? 'apply';
  const confirmation = resolveDeployConfirmation(mode, options.confirmed === true);
  const diagnostics = [...planResult.diagnostics];
  const warnings = [...planResult.warnings];
  const checks: DeployPreflightCheck[] = [...collectStaticMappingChecks(project), ...collectMissingMappingChecks(project)];
  const target = planResult.data?.target ?? {
    stage: project.topology.selectedStage,
    environmentAlias: project.topology.activeEnvironment,
    solutionAlias: project.topology.activeSolution?.alias,
    solutionUniqueName: project.topology.activeSolution?.uniqueName,
  };

  checks.push(...collectExpectedPlanChecks(options.expectedPlan, planResult.data));
  return executePreparedDeploy({
    mode,
    plan: planResult.data,
    bindings: bindingSummary,
    confirmation,
    target,
    checks,
    preparedOperations: prepareProjectDeployOperations(project),
    diagnostics,
    warnings,
    startedAt,
  });
}

export async function executeDeployPlan(
  plan: DeployPlan,
  options: {
    mode?: DeployExecutionMode;
    confirmed?: boolean;
    parameterOverrides?: Record<string, DeployPrimitiveValue>;
  } = {}
): Promise<OperationResult<DeployExecutionResult>> {
  const startedAt = Date.now();
  const mode = options.mode ?? 'apply';
  const confirmation = resolveDeployConfirmation(mode, options.confirmed === true);
  const effectivePlan = applySavedPlanParameterOverrides(plan, options.parameterOverrides);
  const checks: DeployPreflightCheck[] = [
    ...collectSavedPlanMissingChecks(effectivePlan),
    ...collectSavedPlanValueChecks(plan, options.parameterOverrides),
  ];

  return executePreparedDeploy({
    mode,
    plan: effectivePlan,
    bindings: effectivePlan.bindings,
    confirmation,
    target: effectivePlan.target,
    checks,
    preparedOperations: prepareSavedPlanOperations(plan, options.parameterOverrides),
    diagnostics: [],
    warnings: [],
    startedAt,
  });
}

async function executePreparedDeploy(context: {
  mode: DeployExecutionMode;
  plan: DeployPlan | undefined;
  bindings: DeployBindingSummary;
  confirmation: DeployConfirmation;
  target: DeployTarget;
  checks: DeployPreflightCheck[];
  preparedOperations: PreparedDeployOperation[];
  diagnostics: Diagnostic[];
  warnings: Diagnostic[];
  startedAt: number;
}): Promise<OperationResult<DeployExecutionResult>> {
  const { mode, plan, bindings, confirmation, target, preparedOperations, diagnostics, warnings, startedAt } = context;
  const checks = [...context.checks];
  const applyOperations: DeployOperationResult[] = [];
  const conflicts = analyzeDeployTargetConflicts(preparedOperations.map((operation) => operation.plan));
  const dataverseOperations = preparedOperations.filter((operation) => isDataverseMutationOperation(operation.plan));
  const flowOperations = preparedOperations.filter(
    (operation) =>
      isPreparedFlowParameterOperation(operation) ||
      isPreparedFlowConnectionReferenceOperation(operation) ||
      isPreparedFlowEnvironmentVariableOperation(operation)
  );
  const sharePointOperations = preparedOperations.filter(
    (operation): operation is PreparedSharePointFileTextOperation => isSharePointFileTextOperation(operation.plan)
  );
  const powerBiOperations = preparedOperations.filter(
    (operation): operation is PreparedPowerBiDatasetRefreshOperation => isPowerBiDatasetRefreshOperation(operation.plan)
  );
  const adapterBindingOperations = preparedOperations.filter(
    (operation) =>
      !isDataverseMutationOperation(operation.plan) &&
      !isFlowParameterOperation(operation.plan) &&
      !isFlowConnectionReferenceOperation(operation.plan) &&
      !isFlowEnvironmentVariableOperation(operation.plan) &&
      !isSharePointFileTextOperation(operation.plan) &&
      !isPowerBiDatasetRefreshOperation(operation.plan)
  );
  const runnableDataverseOperations: PreparedDeployOperation[] = [];
  const runnableFlowOperations: FlowParameterDeployTargetInspection[] = [];
  const runnableFlowConnectionReferenceOperations: FlowConnectionReferenceDeployTargetInspection[] = [];
  const runnableFlowEnvironmentVariableOperations: FlowEnvironmentVariableDeployTargetInspection[] = [];
  const flowValidationResults = new Map<string, OperationResult<FlowValidationReport>>();
  const flowArtifactResults = new Map<string, OperationResult<FlowArtifact>>();
  const invalidFlowArtifacts = new Set<string>();
  const sharePointInspectionResults = new Map<string, Awaited<ReturnType<SharePointClient['inspectDriveItem']>>>();
  const powerBiInspectionResults = new Map<string, Awaited<ReturnType<PowerBiClient['inspectDataset']>>>();
  const solutionTargetInspectionPromises = new Map<string, Promise<DeploySolutionTargetInspection>>();
  const reportedSolutionTargetInspections = new Set<string>();

  async function getFlowValidation(path: string): Promise<OperationResult<FlowValidationReport>> {
    const cached = flowValidationResults.get(path);

    if (cached) {
      return cached;
    }

    const result = await validateFlowArtifact(path);
    flowValidationResults.set(path, result);
    return result;
  }

  async function getFlowArtifact(path: string): Promise<OperationResult<FlowArtifact>> {
    const cached = flowArtifactResults.get(path);

    if (cached) {
      return cached;
    }

    const result = await loadFlowArtifact(path);
    flowArtifactResults.set(path, result);
    return result;
  }

  async function getSharePointInspection(
    operation: SharePointFileTextDeployOperationPlan
  ): Promise<Awaited<ReturnType<SharePointClient['inspectDriveItem']>>> {
    const key = `${operation.authProfile.toLowerCase()}::${operation.site.toLowerCase()}::${(operation.drive ?? '').toLowerCase()}::${operation.file.toLowerCase()}`;
    const cached = sharePointInspectionResults.get(key);

    if (cached) {
      return cached;
    }

    const clientResult = await createAuthenticatedProviderClient(
      'https://graph.microsoft.com',
      operation.authProfile,
      (httpClient) => new SharePointClient(httpClient)
    );

    if (!clientResult.success || !clientResult.data) {
      const failed = {
        ...clientResult,
      } as Awaited<ReturnType<SharePointClient['inspectDriveItem']>>;
      sharePointInspectionResults.set(key, failed);
      return failed;
    }

    const result = await clientResult.data.inspectDriveItem(operation.site, operation.file, {
      drive: operation.drive,
    });
    sharePointInspectionResults.set(key, result);
    return result;
  }

  async function getPowerBiInspection(
    operation: PowerBiDatasetRefreshDeployOperationPlan
  ): Promise<Awaited<ReturnType<PowerBiClient['inspectDataset']>>> {
    const key = `${operation.authProfile.toLowerCase()}::${operation.workspace.toLowerCase()}::${operation.dataset.toLowerCase()}`;
    const cached = powerBiInspectionResults.get(key);

    if (cached) {
      return cached;
    }

    const clientResult = await createAuthenticatedProviderClient(
      'https://api.powerbi.com',
      operation.authProfile,
      (httpClient) => new PowerBiClient(httpClient)
    );

    if (!clientResult.success || !clientResult.data) {
      const failed = {
        ...clientResult,
      } as Awaited<ReturnType<PowerBiClient['inspectDataset']>>;
      powerBiInspectionResults.set(key, failed);
      return failed;
    }

    const result = await clientResult.data.inspectDataset(operation.workspace, operation.dataset);
    powerBiInspectionResults.set(key, result);
    return result;
  }

  async function getSolutionTargetInspection(
    environmentAlias: string,
    solutionUniqueName: string
  ): Promise<DeploySolutionTargetInspection> {
    const key = `${environmentAlias.toLowerCase()}::${solutionUniqueName.toLowerCase()}`;
    const cached = solutionTargetInspectionPromises.get(key);

    if (cached) {
      return cached;
    }

    const pending = inspectDeploySolutionTarget(environmentAlias, solutionUniqueName);
    solutionTargetInspectionPromises.set(key, pending);
    return pending;
  }

  function recordSolutionTargetInspection(inspection: DeploySolutionTargetInspection): void {
    const key = `${inspection.environmentAlias.toLowerCase()}::${inspection.solutionUniqueName.toLowerCase()}`;

    if (reportedSolutionTargetInspections.has(key)) {
      return;
    }

    reportedSolutionTargetInspections.add(key);
    diagnostics.push(...inspection.diagnostics);
    warnings.push(...inspection.warnings);
    checks.push(...inspection.checks);
  }

  checks.push(
    ...conflicts.map((conflict) => ({
      status: 'fail' as const,
      code: conflict.code,
      message: conflict.message,
      target: conflict.details.target,
      details: conflict.details,
    }))
  );

  for (const path of new Set(flowOperations.map((operation) => operation.plan.path))) {
    const validation = await getFlowValidation(path);

    diagnostics.push(...validation.diagnostics);
    warnings.push(...validation.warnings);

    if (!validation.success || !validation.data) {
      continue;
    }

    if (!validation.data.valid) {
      invalidFlowArtifacts.add(path);
      checks.push({
        status: 'fail',
        code: 'DEPLOY_PREFLIGHT_FLOW_ASSET_VALIDATION_FAILED',
        message: `Flow artifact ${path} failed semantic validation before deploy.`,
        target: path,
        details: {
          path,
          diagnosticCount: validation.diagnostics.length,
          diagnosticCodes: validation.diagnostics.map((diagnostic) => diagnostic.code),
        },
      });
      continue;
    }

    if (validation.warnings.length > 0) {
      checks.push({
        status: 'warn',
        code: 'DEPLOY_PREFLIGHT_FLOW_ASSET_VALIDATION_WARNINGS',
        message: `Flow artifact ${path} has validation warnings that should be reviewed before deploy.`,
        target: path,
        details: {
          path,
          warningCount: validation.warnings.length,
          warningCodes: validation.warnings.map((warning) => warning.code),
        },
      });
    }
  }

  for (const operation of sharePointOperations) {
    const inspection = await getSharePointInspection(operation.plan);
    diagnostics.push(...inspection.diagnostics);
    warnings.push(...inspection.warnings);

    if (!inspection.success || !inspection.data) {
      checks.push({
        status: 'fail',
        code: 'DEPLOY_PREFLIGHT_SHAREPOINT_TARGET_INVALID',
        message: `Failed to inspect SharePoint file target ${operation.plan.target} before deploy.`,
        target: operation.plan.target,
        details: {
          parameter: operation.plan.parameter,
          site: operation.plan.site,
          drive: operation.plan.drive,
          file: operation.plan.file,
        },
      });
      continue;
    }

    checks.push({
      status: 'pass',
      code: 'DEPLOY_PREFLIGHT_SHAREPOINT_TARGET_FOUND',
      message: `SharePoint file target ${operation.plan.target} is available for deploy.`,
      target: operation.plan.target,
      details: {
        fileId: inspection.data.id,
      },
    });
  }

  for (const operation of powerBiOperations) {
    const inspection = await getPowerBiInspection(operation.plan);
    diagnostics.push(...inspection.diagnostics);
    warnings.push(...inspection.warnings);

    if (!inspection.success || !inspection.data) {
      checks.push({
        status: 'fail',
        code: 'DEPLOY_PREFLIGHT_POWERBI_TARGET_INVALID',
        message: `Failed to inspect Power BI dataset target ${operation.plan.target} before deploy.`,
        target: operation.plan.target,
        details: {
          parameter: operation.plan.parameter,
          workspace: operation.plan.workspace,
          dataset: operation.plan.dataset,
        },
      });
      continue;
    }

    if (inspection.data.isRefreshable === false) {
      checks.push({
        status: 'fail',
        code: 'DEPLOY_PREFLIGHT_POWERBI_DATASET_NOT_REFRESHABLE',
        message: `Power BI dataset ${operation.plan.target} is not refreshable.`,
        target: operation.plan.target,
        details: {
          workspace: operation.plan.workspace,
          dataset: operation.plan.dataset,
        },
      });
      continue;
    }

    checks.push({
      status: 'pass',
      code: 'DEPLOY_PREFLIGHT_POWERBI_TARGET_FOUND',
      message: `Power BI dataset ${operation.plan.target} is available for deploy.`,
      target: operation.plan.target,
      details: {
        datasetId: inspection.data.id,
      },
    });
  }

  for (const operation of adapterBindingOperations) {
    if (conflicts.some((conflict) => matchesDeployConflict(operation.plan, conflict))) {
      applyOperations.push({
        ...operation.plan,
        status: 'skipped',
        changed: false,
        message: 'Blocked by conflicting deploy target mappings.',
      });
      continue;
    }

    if (!operation.executable) {
      applyOperations.push({
        ...operation.plan,
        status: 'skipped',
        changed: false,
        message: operation.blockedMessage ?? 'Saved deploy plan does not include an executable value for this binding.',
      });
      continue;
    }

    applyOperations.push({
      ...operation.plan,
      status: 'resolved',
      changed: false,
      message:
        operation.plan.kind === 'deploy-secret-bind'
          ? 'Resolved secret binding for adapter consumption.'
          : 'Resolved input binding for adapter consumption.',
    });
  }

  for (const operation of sharePointOperations) {
    if (conflicts.some((conflict) => matchesDeployConflict(operation.plan, conflict))) {
      applyOperations.push({
        ...operation.plan,
        status: 'skipped',
        changed: false,
        message: 'Blocked by conflicting deploy target mappings.',
      });
      continue;
    }

    if (!operation.executable || operation.value === undefined) {
      applyOperations.push({
        ...operation.plan,
        status: 'skipped',
        changed: false,
        message: operation.blockedMessage ?? 'Saved deploy plan does not include an executable value for this operation.',
      });
      continue;
    }

    const inspection = await getSharePointInspection(operation.plan);

    if (!inspection.success || !inspection.data) {
      applyOperations.push({
        ...operation.plan,
        status: 'skipped',
        nextValue: stringifyDeployValue(operation.value),
        changed: false,
        message: 'SharePoint target could not be inspected.',
      });
      continue;
    }

    if (mode !== 'apply') {
      applyOperations.push({
        ...operation.plan,
        status: 'planned',
        currentValue: inspection.data.webUrl ?? inspection.data.id,
        nextValue: stringifyDeployValue(operation.value),
        changed: true,
        message: 'SharePoint file update is ready to apply.',
      });
      continue;
    }

    const clientResult = await createAuthenticatedProviderClient(
      'https://graph.microsoft.com',
      operation.plan.authProfile,
      (httpClient) => new SharePointClient(httpClient)
    );

    diagnostics.push(...clientResult.diagnostics);
    warnings.push(...clientResult.warnings);

    if (!clientResult.success || !clientResult.data) {
      applyOperations.push({
        ...operation.plan,
        status: 'failed',
        currentValue: inspection.data.webUrl ?? inspection.data.id,
        nextValue: stringifyDeployValue(operation.value),
        changed: false,
        message: `Failed to authenticate SharePoint deploy target ${operation.plan.target}.`,
      });
      continue;
    }

    const result = await clientResult.data.setDriveItemText(
      operation.plan.site,
      operation.plan.file,
      stringifyDeployValue(operation.value),
      {
        drive: operation.plan.drive,
      }
    );

    diagnostics.push(...result.diagnostics);
    warnings.push(...result.warnings);

    if (!result.success || !result.data) {
      applyOperations.push({
        ...operation.plan,
        status: 'failed',
        currentValue: inspection.data.webUrl ?? inspection.data.id,
        nextValue: stringifyDeployValue(operation.value),
        changed: false,
        message: `Failed to update SharePoint file target ${operation.plan.target}.`,
      });
      continue;
    }

    applyOperations.push({
      ...operation.plan,
      status: 'applied',
      currentValue: inspection.data.webUrl ?? inspection.data.id,
      nextValue: result.data.webUrl ?? result.data.id,
      changed: true,
      message: `Updated SharePoint file target ${operation.plan.target}.`,
    });
  }

  for (const operation of powerBiOperations) {
    if (conflicts.some((conflict) => matchesDeployConflict(operation.plan, conflict))) {
      applyOperations.push({
        ...operation.plan,
        status: 'skipped',
        changed: false,
        message: 'Blocked by conflicting deploy target mappings.',
      });
      continue;
    }

    if (!operation.executable || operation.value === undefined) {
      applyOperations.push({
        ...operation.plan,
        status: 'skipped',
        changed: false,
        message: operation.blockedMessage ?? 'Saved deploy plan does not include an executable value for this operation.',
      });
      continue;
    }

    if (typeof operation.value === 'boolean' && operation.value === false) {
      applyOperations.push({
        ...operation.plan,
        status: 'skipped',
        changed: false,
        message: 'Power BI dataset refresh was disabled by a false parameter value.',
      });
      continue;
    }

    const inspection = await getPowerBiInspection(operation.plan);

    if (!inspection.success || !inspection.data) {
      applyOperations.push({
        ...operation.plan,
        status: 'skipped',
        nextValue: stringifyDeployValue(operation.value),
        changed: false,
        message: 'Power BI target could not be inspected.',
      });
      continue;
    }

    if (inspection.data.isRefreshable === false) {
      applyOperations.push({
        ...operation.plan,
        status: 'skipped',
        currentValue: inspection.data.id,
        nextValue: stringifyDeployValue(operation.value),
        changed: false,
        message: 'Power BI dataset is not refreshable.',
      });
      continue;
    }

    if (mode !== 'apply') {
      applyOperations.push({
        ...operation.plan,
        status: 'planned',
        currentValue: inspection.data.id,
        nextValue: 'refresh-requested',
        changed: true,
        message: 'Power BI dataset refresh is ready to apply.',
      });
      continue;
    }

    const clientResult = await createAuthenticatedProviderClient(
      'https://api.powerbi.com',
      operation.plan.authProfile,
      (httpClient) => new PowerBiClient(httpClient)
    );

    diagnostics.push(...clientResult.diagnostics);
    warnings.push(...clientResult.warnings);

    if (!clientResult.success || !clientResult.data) {
      applyOperations.push({
        ...operation.plan,
        status: 'failed',
        currentValue: inspection.data.id,
        nextValue: 'refresh-requested',
        changed: false,
        message: `Failed to authenticate Power BI deploy target ${operation.plan.target}.`,
      });
      continue;
    }

    const result = await clientResult.data.triggerDatasetRefresh(operation.plan.workspace, operation.plan.dataset, {
      notifyOption: operation.plan.notifyOption,
      type: operation.plan.refreshType,
    });

    diagnostics.push(...result.diagnostics);
    warnings.push(...result.warnings);

    if (!result.success || !result.data) {
      applyOperations.push({
        ...operation.plan,
        status: 'failed',
        currentValue: inspection.data.id,
        nextValue: 'refresh-requested',
        changed: false,
        message: `Failed to request Power BI dataset refresh for ${operation.plan.target}.`,
      });
      continue;
    }

    applyOperations.push({
      ...operation.plan,
      status: 'applied',
      currentValue: inspection.data.id,
      nextValue: 'refresh-requested',
      changed: true,
      message: `Requested Power BI dataset refresh for ${operation.plan.target}.`,
    });
  }

  for (const operation of flowOperations) {
    if (conflicts.some((conflict) => matchesDeployConflict(operation.plan, conflict))) {
      applyOperations.push({
        ...operation.plan,
        status: 'skipped',
        nextValue: operation.value === undefined ? undefined : stringifyDeployValue(operation.value),
        changed: false,
        message: 'Blocked by conflicting deploy target mappings.',
      });
      continue;
    }

    if (!operation.executable || operation.value === undefined) {
      applyOperations.push({
        ...operation.plan,
        status: 'skipped',
        changed: false,
        message: operation.blockedMessage ?? 'Saved deploy plan does not include an executable value for this operation.',
      });
      continue;
    }

    if (invalidFlowArtifacts.has(operation.plan.path)) {
      applyOperations.push({
        ...operation.plan,
        status: 'skipped',
        nextValue: stringifyDeployValue(operation.value),
        changed: false,
        message: 'Flow artifact failed semantic validation.',
      });
      continue;
    }

    const artifact = await getFlowArtifact(operation.plan.path);

    if (!artifact.success || !artifact.data) {
      checks.push({
        status: 'fail',
        code: isFlowParameterOperation(operation.plan)
          ? 'DEPLOY_PREFLIGHT_FLOW_PARAMETER_ASSET_INVALID'
          : isFlowConnectionReferenceOperation(operation.plan)
            ? 'DEPLOY_PREFLIGHT_FLOW_CONNREF_ASSET_INVALID'
            : 'DEPLOY_PREFLIGHT_FLOW_ENVVAR_ASSET_INVALID',
        message: `Flow artifact ${operation.plan.path} could not be loaded for deploy apply.`,
        target: operation.plan.target,
        details: {
          parameter: operation.plan.parameter,
          path: operation.plan.path,
        },
      });
      applyOperations.push({
        ...operation.plan,
        status: 'skipped',
        nextValue: stringifyDeployValue(operation.value),
        changed: false,
        message: 'Flow artifact could not be loaded.',
      });
      continue;
    }

    if (isFlowEnvironmentVariableOperation(operation.plan)) {
      if (!artifact.data.metadata.environmentVariables.includes(operation.plan.target)) {
        checks.push({
          status: 'fail',
          code: 'DEPLOY_PREFLIGHT_FLOW_ENVVAR_TARGET_MISSING',
          message: `Flow artifact ${operation.plan.path} does not reference environment variable ${operation.plan.target}.`,
          target: operation.plan.target,
          details: {
            parameter: operation.plan.parameter,
            path: operation.plan.path,
          },
        });
        applyOperations.push({
          ...operation.plan,
          status: 'skipped',
          nextValue: stringifyDeployValue(operation.value),
          changed: false,
          message: 'Target flow environment variable is missing.',
        });
        continue;
      }

      const currentValue = operation.plan.target;
      applyOperations.push({
        ...operation.plan,
        status: 'planned',
        targetExists: true,
        currentValue,
        nextValue: stringifyDeployValue(operation.value),
        changed: currentValue !== stringifyDeployValue(operation.value),
        message: mode === 'apply' ? 'Ready to apply.' : 'Preview only.',
      });
      runnableFlowEnvironmentVariableOperations.push({
        operation: operation as PreparedDeployOperation & { plan: FlowEnvironmentVariableDeployOperationPlan; value: DeployPrimitiveValue },
        currentValue,
      });
      continue;
    }

    if (isFlowParameterOperation(operation.plan)) {
      if (!Object.hasOwn(artifact.data.metadata.parameters, operation.plan.target)) {
        checks.push({
          status: 'fail',
          code: 'DEPLOY_PREFLIGHT_FLOW_PARAMETER_TARGET_MISSING',
          message: `Flow artifact ${operation.plan.path} does not define parameter ${operation.plan.target}.`,
          target: operation.plan.target,
          details: {
            parameter: operation.plan.parameter,
            path: operation.plan.path,
          },
        });
        applyOperations.push({
          ...operation.plan,
          status: 'skipped',
          nextValue: stringifyDeployValue(operation.value),
          changed: false,
          message: 'Target flow parameter is missing.',
        });
        continue;
      }

      const currentValue = artifact.data.metadata.parameters[operation.plan.target];
      applyOperations.push({
        ...operation.plan,
        status: 'planned',
        targetExists: true,
        currentValue: stringifyDeployArtifactValue(currentValue),
        nextValue: stringifyDeployValue(operation.value),
        changed: !isDeepStrictEqual(currentValue, operation.value),
        message: mode === 'apply' ? 'Ready to apply.' : 'Preview only.',
      });
      runnableFlowOperations.push({
        operation: operation as PreparedDeployOperation & { plan: FlowParameterDeployOperationPlan; value: DeployPrimitiveValue },
        currentValue,
      });
      continue;
    }

    const currentReference = artifact.data.metadata.connectionReferences.find((reference) => reference.name === operation.plan.target);

    if (!currentReference) {
      checks.push({
        status: 'fail',
        code: 'DEPLOY_PREFLIGHT_FLOW_CONNREF_TARGET_MISSING',
        message: `Flow artifact ${operation.plan.path} does not define connection reference ${operation.plan.target}.`,
        target: operation.plan.target,
        details: {
          parameter: operation.plan.parameter,
          path: operation.plan.path,
        },
      });
      applyOperations.push({
        ...operation.plan,
        status: 'skipped',
        nextValue: stringifyDeployValue(operation.value),
        changed: false,
        message: 'Target flow connection reference is missing.',
      });
      continue;
    }

    const currentValue = currentReference.connectionReferenceLogicalName ?? currentReference.name;
    applyOperations.push({
      ...operation.plan,
      status: 'planned',
      targetExists: true,
      currentValue,
      nextValue: stringifyDeployValue(operation.value),
      changed: currentValue !== stringifyDeployValue(operation.value),
      message: mode === 'apply' ? 'Ready to apply.' : 'Preview only.',
    });
    runnableFlowConnectionReferenceOperations.push({
      operation: operation as PreparedDeployOperation & { plan: FlowConnectionReferenceDeployOperationPlan; value: DeployPrimitiveValue },
      currentValue,
    });
  }

  const flowTargetGroups = groupPreparedFlowOperationsByTarget(flowOperations, target);

  for (const group of flowTargetGroups) {
    const inspection = await getSolutionTargetInspection(group.environmentAlias, group.solutionUniqueName);
    recordSolutionTargetInspection(inspection);

    if (!inspection.solutionFound) {
      continue;
    }

    const operationsByPath = new Map<string, PreparedDeployOperation[]>();

    for (const operation of group.operations) {
      if (!isPreparedFlowParameterOperation(operation) && !isPreparedFlowConnectionReferenceOperation(operation) && !isPreparedFlowEnvironmentVariableOperation(operation)) {
        continue;
      }

      const existing = operationsByPath.get(operation.plan.path);

      if (existing) {
        existing.push(operation);
      } else {
        operationsByPath.set(operation.plan.path, [operation]);
      }
    }

    for (const [path, artifactOperations] of operationsByPath.entries()) {
      if (invalidFlowArtifacts.has(path)) {
        continue;
      }

      const artifact = await getFlowArtifact(path);

      if (!artifact.success || !artifact.data) {
        continue;
      }

      const projection = projectFlowArtifactRemoteTargets(artifact.data, artifactOperations);

      for (const reference of projection.connectionReferences) {
        const discovered = inspection.referenceByLogicalName.get(reference.projectedLogicalName.toLowerCase());

        if (!discovered) {
          checks.push({
            status: 'fail',
            code: 'DEPLOY_PREFLIGHT_FLOW_TARGET_CONNREF_MISSING',
            message: `Flow artifact ${path} projects connection reference ${reference.projectedLogicalName} but it was not found in solution ${group.solutionUniqueName}.`,
            target: reference.projectedLogicalName,
            details: {
              path,
              environmentAlias: group.environmentAlias,
              solutionUniqueName: group.solutionUniqueName,
              artifactReference: reference.artifactReference,
              projectedLogicalName: reference.projectedLogicalName,
            },
          });
          continue;
        }

        if (!discovered.connected) {
          checks.push({
            status: 'warn',
            code: 'DEPLOY_PREFLIGHT_FLOW_TARGET_CONNREF_UNBOUND',
            message: `Flow artifact ${path} projects connection reference ${reference.projectedLogicalName}, but the target reference is not connected in ${group.environmentAlias}.`,
            target: reference.projectedLogicalName,
            details: {
              path,
              environmentAlias: group.environmentAlias,
              solutionUniqueName: group.solutionUniqueName,
              artifactReference: reference.artifactReference,
              projectedLogicalName: reference.projectedLogicalName,
            },
          });
        }
      }

      for (const variable of projection.environmentVariables) {
        const discovered = inspection.variableBySchema.get(variable.projectedSchemaName.toLowerCase());

        if (!discovered) {
          checks.push({
            status: 'fail',
            code: 'DEPLOY_PREFLIGHT_FLOW_TARGET_ENVVAR_MISSING',
            message: `Flow artifact ${path} projects environment variable ${variable.projectedSchemaName} but it was not found in solution ${group.solutionUniqueName}.`,
            target: variable.projectedSchemaName,
            details: {
              path,
              environmentAlias: group.environmentAlias,
              solutionUniqueName: group.solutionUniqueName,
              artifactVariable: variable.artifactVariable,
              projectedSchemaName: variable.projectedSchemaName,
            },
          });
          continue;
        }

        if (!discovered.effectiveValue) {
          checks.push({
            status: 'warn',
            code: 'DEPLOY_PREFLIGHT_FLOW_TARGET_ENVVAR_VALUE_MISSING',
            message: `Flow artifact ${path} projects environment variable ${variable.projectedSchemaName}, but the target variable does not have an effective value.`,
            target: variable.projectedSchemaName,
            details: {
              path,
              environmentAlias: group.environmentAlias,
              solutionUniqueName: group.solutionUniqueName,
              artifactVariable: variable.artifactVariable,
              projectedSchemaName: variable.projectedSchemaName,
            },
          });
        }
      }
    }
  }

  for (const operation of dataverseOperations) {
    if (conflicts.some((conflict) => matchesDeployConflict(operation.plan, conflict))) {
      applyOperations.push({
        ...operation.plan,
        status: 'skipped',
        nextValue: operation.value === undefined ? undefined : stringifyDeployValue(operation.value),
        changed: false,
        message: 'Blocked by conflicting deploy target mappings.',
      });
      continue;
    }

    const operationEnvironmentAlias = resolveOperationEnvironmentAlias(operation.plan, target.environmentAlias);
    const operationSolutionUniqueName = resolveOperationSolutionUniqueName(operation.plan, target.solutionUniqueName);

    if (!operationEnvironmentAlias) {
      checks.push({
        status: 'fail',
        code: 'DEPLOY_PREFLIGHT_ENVIRONMENT_MISSING',
        message: `Deploy target environment is not resolved for ${operation.plan.target}.`,
        target: operation.plan.target,
        details: {
          parameter: operation.plan.parameter,
          operationKind: operation.plan.kind,
          solution: operation.plan.solutionAlias,
        },
      });
      applyOperations.push({
        ...operation.plan,
        status: 'skipped',
        nextValue: operation.value === undefined ? undefined : stringifyDeployValue(operation.value),
        changed: false,
        message: 'Deploy target environment is not resolved.',
      });
      continue;
    }

    if (!operationSolutionUniqueName) {
      checks.push({
        status: 'fail',
        code: 'DEPLOY_PREFLIGHT_SOLUTION_MISSING',
        message: `Deploy target solution is not resolved for ${operation.plan.target}.`,
        target: operation.plan.target,
        details: {
          parameter: operation.plan.parameter,
          operationKind: operation.plan.kind,
          solution: operation.plan.solutionAlias,
        },
      });
      applyOperations.push({
        ...operation.plan,
        status: 'skipped',
        nextValue: operation.value === undefined ? undefined : stringifyDeployValue(operation.value),
        changed: false,
        message: 'Deploy target solution is not resolved.',
      });
      continue;
    }

    if (!operation.executable) {
      applyOperations.push({
        ...operation.plan,
        status: 'skipped',
        nextValue: operation.value === undefined ? undefined : stringifyDeployValue(operation.value),
        changed: false,
        message: operation.blockedMessage ?? 'Saved deploy plan does not include an executable value for this operation.',
      });
      continue;
    }

    runnableDataverseOperations.push(operation);
  }

  if (preparedOperations.length === 0) {
    checks.push({
      status: 'warn',
      code: 'DEPLOY_PREFLIGHT_NO_SUPPORTED_OPERATIONS',
      message: 'The current deploy slice found no supported operations for apply.',
    });
  }

  if (confirmation.status === 'blocked') {
    checks.push({
      status: 'fail',
      code: 'DEPLOY_PREFLIGHT_APPLY_CONFIRMATION_REQUIRED',
      message: 'Live deploy apply requires explicit confirmation.',
      details: {
        confirmationFlag: '--yes',
      },
    });
  }

  if (
    (runnableDataverseOperations.length === 0 &&
      runnableFlowOperations.length === 0 &&
      runnableFlowConnectionReferenceOperations.length === 0 &&
      runnableFlowEnvironmentVariableOperations.length === 0) ||
    !plan
  ) {
    return ok(finalizeDeployExecution(mode, target, plan, bindings, confirmation, checks, applyOperations, startedAt), {
      supportTier: 'preview',
      diagnostics,
      warnings,
    });
  }
  const dataverseGroups = groupPreparedDataverseOperations(runnableDataverseOperations, target);

  for (const group of dataverseGroups) {
    const inspection = await getSolutionTargetInspection(group.environmentAlias, group.solutionUniqueName);
    recordSolutionTargetInspection(inspection);

    const solutionAnalysis = inspection.solutionAnalysis;
    const referenceByLogicalName = inspection.referenceByLogicalName;
    const variableBySchema = inspection.variableBySchema;

    for (const operation of group.operations) {
      const nextValue = stringifyDeployValue(operation.value!);

      if (isDataverseEnvvarOperation(operation.plan) || isDataverseEnvvarUpsertOperation(operation.plan)) {
        const variable = variableBySchema.get(operation.plan.target.toLowerCase());

        if (!variable) {
          if (isDataverseEnvvarUpsertOperation(operation.plan)) {
            const invalidType = resolveInvalidEnvironmentVariableCreateType(operation.plan.createOptions?.type);

            if (invalidType !== undefined) {
              checks.push({
                status: 'fail',
                code: 'DEPLOY_PREFLIGHT_ENVVAR_CREATE_TYPE_INVALID',
                message: `Environment variable ${operation.plan.target} is configured with unsupported create type ${String(invalidType)}.`,
                target: operation.plan.target,
                details: {
                  parameter: operation.plan.parameter,
                  configuredType: invalidType,
                },
              });
              applyOperations.push({
                ...operation.plan,
                status: 'skipped',
                targetExists: false,
                nextValue,
                changed: false,
                message: 'Configured environment variable create type is not supported.',
              });
              continue;
            }

            checks.push({
              status: 'pass',
              code: 'DEPLOY_PREFLIGHT_ENVVAR_TARGET_CREATE',
              message: `Environment variable ${operation.plan.target} will be created in solution ${group.solutionUniqueName}.`,
              target: operation.plan.target,
              details: {
                parameter: operation.plan.parameter,
              },
            });
            applyOperations.push({
              ...operation.plan,
              status: 'planned',
              targetExists: false,
              nextValue,
              changed: true,
              message: mode === 'apply' ? 'Ready to create and apply.' : 'Preview will create the missing target.',
            });
            continue;
          }

          checks.push({
            status: 'fail',
            code: 'DEPLOY_PREFLIGHT_ENVVAR_TARGET_MISSING',
            message: `Environment variable ${operation.plan.target} was not found in solution ${group.solutionUniqueName}.`,
            target: operation.plan.target,
            details: {
              parameter: operation.plan.parameter,
            },
          });
          applyOperations.push({
            ...operation.plan,
            status: 'skipped',
            targetExists: false,
            nextValue,
            message: 'Target environment variable is missing.',
          });
          continue;
        }

        if (isDataverseEnvvarUpsertOperation(operation.plan)) {
          const metadataMismatch = resolveEnvironmentVariableCreateMetadataMismatch(variable, operation.plan.createOptions);

          if (metadataMismatch) {
            checks.push({
              status: 'fail',
              code: 'DEPLOY_PREFLIGHT_ENVVAR_CREATE_METADATA_MISMATCH',
              message: `Environment variable ${operation.plan.target} does not match the configured create metadata.`,
              target: operation.plan.target,
              details: {
                parameter: operation.plan.parameter,
                ...metadataMismatch,
              },
            });
            applyOperations.push({
              ...operation.plan,
              status: 'skipped',
              targetExists: true,
              currentValue: variable.effectiveValue,
              nextValue,
              changed: false,
              message: 'Existing environment variable metadata does not match the configured create mapping.',
            });
            continue;
          }
        }

        applyOperations.push({
          ...operation.plan,
          status: 'planned',
          targetExists: true,
          currentValue: variable.effectiveValue,
          nextValue,
          changed: variable.effectiveValue !== nextValue,
          message: mode === 'apply' ? 'Ready to apply.' : 'Preview only.',
        });
        continue;
      }

      if (isDataverseConnectionReferenceOperation(operation.plan) || isDataverseConnectionReferenceUpsertOperation(operation.plan)) {
        const reference = referenceByLogicalName.get(operation.plan.target.toLowerCase());

        if (!reference) {
          if (isDataverseConnectionReferenceUpsertOperation(operation.plan)) {
            const missingConnector = resolveMissingConnectionReferenceConnector(operation.plan.createOptions);

            if (missingConnector) {
              checks.push({
                status: 'fail',
                code: 'DEPLOY_PREFLIGHT_CONNREF_CREATE_CONNECTOR_MISSING',
                message: `Connection reference ${operation.plan.target} is configured without connector metadata for creation.`,
                target: operation.plan.target,
                details: {
                  parameter: operation.plan.parameter,
                },
              });
              applyOperations.push({
                ...operation.plan,
                status: 'skipped',
                targetExists: false,
                nextValue,
                changed: false,
                message: 'Configured connection reference create mapping is missing connector metadata.',
              });
              continue;
            }

            checks.push({
              status: 'pass',
              code: 'DEPLOY_PREFLIGHT_CONNREF_TARGET_CREATE',
              message: `Connection reference ${operation.plan.target} will be created in solution ${group.solutionUniqueName}.`,
              target: operation.plan.target,
              details: {
                parameter: operation.plan.parameter,
              },
            });
            applyOperations.push({
              ...operation.plan,
              status: 'planned',
              targetExists: false,
              nextValue,
              changed: true,
              message: mode === 'apply' ? 'Ready to create and apply.' : 'Preview will create the missing target.',
            });
            continue;
          }

          checks.push({
            status: 'fail',
            code: 'DEPLOY_PREFLIGHT_CONNREF_TARGET_MISSING',
            message: `Connection reference ${operation.plan.target} was not found in solution ${group.solutionUniqueName}.`,
            target: operation.plan.target,
            details: {
              parameter: operation.plan.parameter,
            },
          });
          applyOperations.push({
            ...operation.plan,
            status: 'skipped',
            targetExists: false,
            nextValue,
            message: 'Target connection reference is missing.',
          });
          continue;
        }

        if (isDataverseConnectionReferenceUpsertOperation(operation.plan)) {
          const metadataMismatch = resolveConnectionReferenceCreateMetadataMismatch(reference, operation.plan.createOptions);

          if (metadataMismatch) {
            checks.push({
              status: 'fail',
              code: 'DEPLOY_PREFLIGHT_CONNREF_CREATE_METADATA_MISMATCH',
              message: `Connection reference ${operation.plan.target} does not match the configured create metadata.`,
              target: operation.plan.target,
              details: {
                parameter: operation.plan.parameter,
                ...metadataMismatch,
              },
            });
            applyOperations.push({
              ...operation.plan,
              status: 'skipped',
              targetExists: true,
              currentValue: reference.connectionId,
              nextValue,
              changed: false,
              message: 'Existing connection reference metadata does not match the configured create mapping.',
            });
            continue;
          }
        }

        applyOperations.push({
          ...operation.plan,
          status: 'planned',
          targetExists: true,
          currentValue: reference.connectionId,
          nextValue,
          changed: reference.connectionId !== nextValue,
          message: mode === 'apply' ? 'Ready to apply.' : 'Preview only.',
        });
      }
    }
  }

  const preflightOk = checks.every((check) => check.status !== 'fail');

  if (!preflightOk || mode !== 'apply') {
    return ok(finalizeDeployExecution(mode, target, plan, bindings, confirmation, checks, applyOperations, startedAt), {
      supportTier: 'preview',
      diagnostics,
      warnings,
    });
  }

  for (const inspection of runnableFlowOperations) {
    const index = applyOperations.findIndex(
      (entry) =>
        entry.kind === 'flow-parameter-set' &&
        entry.parameter === inspection.operation.plan.parameter &&
        entry.target === inspection.operation.plan.target &&
        entry.path === inspection.operation.plan.path
    );

    if (index === -1) {
      continue;
    }

    const existingOperation = applyOperations[index]!;

    if (existingOperation.changed === false) {
      applyOperations[index] = {
        ...existingOperation,
        status: 'skipped',
        message: `${inspection.operation.plan.target} is already up to date in ${inspection.operation.plan.path}.`,
      };
      continue;
    }

    const result = await patchFlowArtifact(inspection.operation.plan.path, {
      parameters: {
        [inspection.operation.plan.target]: inspection.operation.value,
      },
    });

    if (!result.success) {
      diagnostics.push(...result.diagnostics);
      warnings.push(...result.warnings);
      applyOperations[index] = {
        ...existingOperation,
        status: 'failed',
        message: `Failed to update flow parameter ${inspection.operation.plan.target}.`,
      };
      continue;
    }

    diagnostics.push(...result.diagnostics);
    warnings.push(...result.warnings);
    applyOperations[index] = {
      ...existingOperation,
      status: 'applied',
      changed: true,
      message: `Updated flow parameter ${inspection.operation.plan.target}.`,
    };
  }

  for (const inspection of runnableFlowConnectionReferenceOperations) {
    const index = applyOperations.findIndex(
      (entry) =>
        entry.kind === 'flow-connref-set' &&
        entry.parameter === inspection.operation.plan.parameter &&
        entry.target === inspection.operation.plan.target &&
        entry.path === inspection.operation.plan.path
    );

    if (index === -1) {
      continue;
    }

    const existingOperation = applyOperations[index]!;

    if (existingOperation.changed === false) {
      applyOperations[index] = {
        ...existingOperation,
        status: 'skipped',
        message: `${inspection.operation.plan.target} is already up to date in ${inspection.operation.plan.path}.`,
      };
      continue;
    }

    const result = await patchFlowArtifact(inspection.operation.plan.path, {
      connectionReferences: {
        [inspection.operation.plan.target]: stringifyDeployValue(inspection.operation.value),
      },
    });

    if (!result.success) {
      diagnostics.push(...result.diagnostics);
      warnings.push(...result.warnings);
      applyOperations[index] = {
        ...existingOperation,
        status: 'failed',
        message: `Failed to update flow connection reference ${inspection.operation.plan.target}.`,
      };
      continue;
    }

    diagnostics.push(...result.diagnostics);
    warnings.push(...result.warnings);
    applyOperations[index] = {
      ...existingOperation,
      status: 'applied',
      changed: true,
      message: `Updated flow connection reference ${inspection.operation.plan.target}.`,
    };
  }

  for (const inspection of runnableFlowEnvironmentVariableOperations) {
    const index = applyOperations.findIndex(
      (entry) =>
        entry.kind === 'flow-envvar-set' &&
        entry.parameter === inspection.operation.plan.parameter &&
        entry.target === inspection.operation.plan.target &&
        entry.path === inspection.operation.plan.path
    );

    if (index === -1) {
      continue;
    }

    const existingOperation = applyOperations[index]!;

    if (existingOperation.changed === false) {
      applyOperations[index] = {
        ...existingOperation,
        status: 'skipped',
        message: `${inspection.operation.plan.target} is already up to date in ${inspection.operation.plan.path}.`,
      };
      continue;
    }

    const result = await patchFlowArtifact(inspection.operation.plan.path, {
      environmentVariables: {
        [inspection.operation.plan.target]: stringifyDeployValue(inspection.operation.value),
      },
    });

    if (!result.success) {
      diagnostics.push(...result.diagnostics);
      warnings.push(...result.warnings);
      applyOperations[index] = {
        ...existingOperation,
        status: 'failed',
        message: `Failed to update flow environment variable ${inspection.operation.plan.target}.`,
      };
      continue;
    }

    diagnostics.push(...result.diagnostics);
    warnings.push(...result.warnings);
    applyOperations[index] = {
      ...existingOperation,
      status: 'applied',
      changed: true,
      message: `Updated flow environment variable ${inspection.operation.plan.target}.`,
    };
  }

  for (const group of dataverseGroups) {
    const resolution = await resolveDataverseClient(group.environmentAlias);

    if (!resolution.success || !resolution.data) {
      continue;
    }

    const connectionReferences = new ConnectionReferenceService(resolution.data.client);
    const environmentVariables = new EnvironmentVariableService(resolution.data.client);

    for (const operation of group.operations) {
    const index = applyOperations.findIndex(
      (entry) => entry.kind === operation.plan.kind && entry.parameter === operation.plan.parameter && entry.target === operation.plan.target
    );

    if (index === -1) {
      continue;
    }

    const existingOperation = applyOperations[index]!;

    if (
      existingOperation.targetExists === false &&
      !isDataverseEnvvarUpsertOperation(operation.plan) &&
      !isDataverseConnectionReferenceUpsertOperation(operation.plan)
    ) {
      continue;
    }

    if (existingOperation.changed === false) {
      applyOperations[index] = {
        ...existingOperation,
        status: 'skipped',
        message: `${operation.plan.target} is already up to date.`,
      };
      continue;
    }

    const nextValue = stringifyDeployValue(operation.value!);

    if (isDataverseEnvvarOperation(operation.plan) || isDataverseEnvvarUpsertOperation(operation.plan)) {
      if (existingOperation.targetExists === false && isDataverseEnvvarUpsertOperation(operation.plan)) {
        const createResult = await environmentVariables.createDefinition(operation.plan.target, {
          ...toEnvironmentVariableCreateOptions(operation.plan.createOptions),
          type: operation.plan.createOptions?.type ?? inferEnvironmentVariableType(operation.value!),
          solutionUniqueName: group.solutionUniqueName,
        });

        if (!createResult.success || !createResult.data) {
          diagnostics.push(...createResult.diagnostics);
          warnings.push(...createResult.warnings);
          applyOperations[index] = {
            ...existingOperation,
            status: 'failed',
            message: `Failed to create ${operation.plan.target}.`,
          };
          continue;
        }
      }

      const result = await environmentVariables.setValue(
        operation.plan.target,
        nextValue,
        existingOperation.targetExists === false && isDataverseEnvvarUpsertOperation(operation.plan)
          ? {}
          : {
              solutionUniqueName: group.solutionUniqueName,
            }
      );

      if (!result.success || !result.data) {
        diagnostics.push(...result.diagnostics);
        warnings.push(...result.warnings);
        applyOperations[index] = {
          ...existingOperation,
          status: 'failed',
          message: `Failed to update ${operation.plan.target}.`,
        };
        continue;
      }

      applyOperations[index] = {
        ...existingOperation,
        created:
          existingOperation.targetExists === false && isDataverseEnvvarUpsertOperation(operation.plan) ? true : undefined,
        status: 'applied',
        currentValue: existingOperation.currentValue,
        nextValue: result.data.effectiveValue,
        changed: true,
        message:
          existingOperation.targetExists === false && isDataverseEnvvarUpsertOperation(operation.plan)
            ? `Created and updated ${operation.plan.target}.`
            : `Updated ${operation.plan.target}.`,
      };
      continue;
    }

    if (isDataverseConnectionReferenceOperation(operation.plan) || isDataverseConnectionReferenceUpsertOperation(operation.plan)) {
      if (existingOperation.targetExists === false && isDataverseConnectionReferenceUpsertOperation(operation.plan)) {
        const createResult = await connectionReferences.create(operation.plan.target, nextValue, {
          ...toConnectionReferenceCreateOptions(operation.plan.createOptions),
          solutionUniqueName: group.solutionUniqueName,
        });

        if (!createResult.success || !createResult.data) {
          diagnostics.push(...createResult.diagnostics);
          warnings.push(...createResult.warnings);
          applyOperations[index] = {
            ...existingOperation,
            status: 'failed',
            message: `Failed to create ${operation.plan.target}.`,
          };
          continue;
        }

        applyOperations[index] = {
          ...existingOperation,
          created: true,
          status: 'applied',
          currentValue: existingOperation.currentValue,
          nextValue: createResult.data.connectionId,
          changed: true,
          message: `Created and updated ${operation.plan.target}.`,
        };
        continue;
      }

      const result = await connectionReferences.setConnectionId(operation.plan.target, nextValue, {
        solutionUniqueName: group.solutionUniqueName,
      });

      if (!result.success || !result.data) {
        diagnostics.push(...result.diagnostics);
        warnings.push(...result.warnings);
        applyOperations[index] = {
          ...existingOperation,
          status: 'failed',
          message: `Failed to update ${operation.plan.target}.`,
        };
        continue;
      }

      applyOperations[index] = {
        ...existingOperation,
        status: 'applied',
        currentValue: existingOperation.currentValue,
        nextValue: result.data.connectionId,
        changed: true,
        message: `Updated ${operation.plan.target}.`,
      };
      continue;
    }
    }
  }

  return ok(finalizeDeployExecution(mode, target, plan, bindings, confirmation, checks, applyOperations, startedAt), {
    supportTier: 'preview',
    diagnostics,
    warnings,
  });
}

function collectDeployOperations(project: ProjectContext): Array<{ plan: DeployOperationPlan; value: string | number | boolean }> {
  const operations: Array<{ plan: DeployOperationPlan; value: string | number | boolean }> = [];

  for (const parameter of Object.values(project.parameters)) {
    if (!parameter.hasValue || parameter.value === undefined) {
      continue;
    }

    for (const mapping of parameter.definition.mapsTo ?? []) {
      const plan = createDeployOperationPlan(project, parameter, mapping);

      if (plan) {
        operations.push({
          plan,
          value: parameter.value,
        });
      }
    }
  }

  return operations;
}

function prepareProjectDeployOperations(project: ProjectContext): PreparedDeployOperation[] {
  return collectDeployOperations(project).map((operation) => ({
    ...operation,
    executable: true,
  }));
}

function prepareSavedPlanOperations(
  plan: DeployPlan,
  parameterOverrides: Record<string, DeployPrimitiveValue> = {}
): PreparedDeployOperation[] {
  return plan.operations.map((operation) => {
    if (Object.hasOwn(parameterOverrides, operation.parameter)) {
      return {
        plan: applySavedPlanOperationOverride(operation, parameterOverrides[operation.parameter]!),
        value: parameterOverrides[operation.parameter]!,
        executable: true,
      };
    }

    if (operation.valuePreview === undefined) {
      return {
        plan: operation,
        executable: false,
        blockedCode: 'DEPLOY_PREFLIGHT_PLAN_OPERATION_VALUE_MISSING',
        blockedMessage: `Saved deploy plan does not include a resolved value for ${operation.target}.`,
      };
    }

    if (isDeployValueRedacted(operation.valuePreview)) {
      return {
        plan: operation,
        executable: false,
        blockedCode: 'DEPLOY_PREFLIGHT_PLAN_OPERATION_VALUE_REDACTED',
        blockedMessage: `Saved deploy plan redacted the resolved value for ${operation.target}; rediscover the project to execute it.`,
      };
    }

    return {
      plan: operation,
      value: operation.valuePreview,
      executable: true,
    };
  });
}

function createDeployOperationPlan(
  project: ProjectContext,
  parameter: ResolvedProjectParameter,
  mapping: ParameterMapping
): DeployOperationPlan | undefined {
  const valuePreview = parameter.sensitive ? '<redacted>' : parameter.value;
  const resolvedTarget = resolveDeployMappingTarget(project, mapping);
  const environmentAlias = resolvedTarget.environmentAlias;
  const solutionAlias = resolvedTarget.solutionAlias;
  const solutionUniqueName = resolvedTarget.solutionUniqueName;

  switch (mapping.kind) {
    case 'dataverse-envvar':
      return {
        kind: 'dataverse-envvar-set',
        parameter: parameter.name,
        source: parameter.source,
        sensitive: parameter.sensitive,
        environmentAlias,
        solutionAlias,
        solutionUniqueName,
        target: mapping.target,
        valuePreview,
      };
    case 'dataverse-envvar-create':
      return {
        kind: 'dataverse-envvar-upsert',
        parameter: parameter.name,
        source: parameter.source,
        sensitive: parameter.sensitive,
        environmentAlias,
        solutionAlias,
        solutionUniqueName,
        target: mapping.target,
        valuePreview,
        createOptions: resolveDeployEnvironmentVariableCreateOptions(mapping),
      };
    case 'dataverse-connref':
      return {
        kind: 'dataverse-connref-set',
        parameter: parameter.name,
        source: parameter.source,
        sensitive: parameter.sensitive,
        environmentAlias,
        solutionAlias,
        solutionUniqueName,
        target: mapping.target,
        valuePreview,
      };
    case 'dataverse-connref-create':
      return {
        kind: 'dataverse-connref-upsert',
        parameter: parameter.name,
        source: parameter.source,
        sensitive: parameter.sensitive,
        environmentAlias,
        solutionAlias,
        solutionUniqueName,
        target: mapping.target,
        valuePreview,
        createOptions: resolveDeployConnectionReferenceCreateOptions(mapping),
      };
    case 'deploy-input':
      return {
        kind: 'deploy-input-bind',
        parameter: parameter.name,
        source: parameter.source,
        sensitive: parameter.sensitive,
        target: mapping.target,
        valuePreview,
      };
    case 'deploy-secret':
      return {
        kind: 'deploy-secret-bind',
        parameter: parameter.name,
        source: parameter.source,
        sensitive: parameter.sensitive,
        target: mapping.target,
        valuePreview,
      };
    case 'flow-parameter':
      return mapping.path
        ? {
            kind: 'flow-parameter-set',
            parameter: parameter.name,
            source: parameter.source,
            sensitive: parameter.sensitive,
            target: mapping.target,
            path: resolveDeployFlowPath(project, mapping.path),
            valuePreview,
          }
        : undefined;
    case 'flow-connref':
      return mapping.path
        ? {
            kind: 'flow-connref-set',
            parameter: parameter.name,
            source: parameter.source,
            sensitive: parameter.sensitive,
            target: mapping.target,
            path: resolveDeployFlowPath(project, mapping.path),
            valuePreview,
          }
        : undefined;
    case 'flow-envvar':
      return mapping.path
        ? {
            kind: 'flow-envvar-set',
            parameter: parameter.name,
            source: parameter.source,
            sensitive: parameter.sensitive,
            target: mapping.target,
            path: resolveDeployFlowPath(project, mapping.path),
            valuePreview,
          }
        : undefined;
    case 'sharepoint-file-text':
      return createSharePointFileTextOperationPlan(project, parameter, mapping, valuePreview);
    case 'powerbi-dataset-refresh':
      return createPowerBiDatasetRefreshOperationPlan(project, parameter, mapping, valuePreview);
    default:
      return undefined;
  }
}

function createSharePointFileTextOperationPlan(
  project: ProjectContext,
  parameter: ResolvedProjectParameter,
  mapping: ParameterMapping,
  valuePreview: string | number | boolean | undefined
): SharePointFileTextDeployOperationPlan | undefined {
  const resolvedTarget = resolveSharePointTarget(project, mapping.target, {
    expectedKind: 'sharepoint-file',
    site: mapping.site,
    drive: mapping.drive,
  });

  if (!resolvedTarget.success || !resolvedTarget.data?.file) {
    return undefined;
  }

  if (!resolvedTarget.data.authProfile) {
    return undefined;
  }

  return {
    kind: 'sharepoint-file-text-set',
    parameter: parameter.name,
    source: parameter.source,
    sensitive: parameter.sensitive,
    target: mapping.target,
    valuePreview,
    authProfile: resolvedTarget.data.authProfile,
    bindingName: resolvedTarget.data.bindingName,
    site: resolvedTarget.data.site.value,
    drive: resolvedTarget.data.drive?.value,
    file: resolvedTarget.data.file.value,
  };
}

function createPowerBiDatasetRefreshOperationPlan(
  project: ProjectContext,
  parameter: ResolvedProjectParameter,
  mapping: ParameterMapping,
  valuePreview: string | number | boolean | undefined
): PowerBiDatasetRefreshDeployOperationPlan | undefined {
  const resolvedTarget = resolvePowerBiTarget(project, mapping.target, {
    expectedKind: 'powerbi-dataset',
    workspace: mapping.workspace,
  });

  if (!resolvedTarget.success || !resolvedTarget.data?.dataset) {
    return undefined;
  }

  if (!resolvedTarget.data.authProfile) {
    return undefined;
  }

  return {
    kind: 'powerbi-dataset-refresh',
    parameter: parameter.name,
    source: parameter.source,
    sensitive: parameter.sensitive,
    target: mapping.target,
    valuePreview,
    authProfile: resolvedTarget.data.authProfile,
    bindingName: resolvedTarget.data.bindingName,
    workspace: resolvedTarget.data.workspace.value,
    dataset: resolvedTarget.data.dataset.value,
    notifyOption: mapping.notifyOption,
    refreshType: mapping.refreshType,
  };
}

function collectProviderOperationDiagnostics(project: ProjectContext): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const parameter of Object.values(project.parameters)) {
    for (const mapping of parameter.definition.mapsTo ?? []) {
      if (mapping.kind === 'sharepoint-file-text') {
        diagnostics.push(...resolveSharePointDeployMappingDiagnostics(project, parameter, mapping));
      } else if (mapping.kind === 'powerbi-dataset-refresh') {
        diagnostics.push(...resolvePowerBiDeployMappingDiagnostics(project, parameter, mapping));
      }
    }
  }

  return diagnostics;
}

function resolveSharePointDeployMappingDiagnostics(
  project: ProjectContext,
  parameter: ResolvedProjectParameter,
  mapping: ParameterMapping
): Diagnostic[] {
  const resolvedTarget = resolveSharePointTarget(project, mapping.target, {
    expectedKind: 'sharepoint-file',
    site: mapping.site,
    drive: mapping.drive,
  });

  if (!resolvedTarget.success) {
    return resolvedTarget.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      source: diagnostic.source ?? '@pp/deploy',
      detail: diagnostic.detail ?? `Deploy parameter ${parameter.name} could not resolve SharePoint target ${mapping.target}.`,
    }));
  }

  if (!resolvedTarget.data?.authProfile) {
    return [
      createDiagnostic(
        'error',
        'DEPLOY_PREFLIGHT_SHAREPOINT_AUTH_PROFILE_MISSING',
        `Deploy parameter ${parameter.name} maps to SharePoint target ${mapping.target} without an auth profile.`,
        {
          source: '@pp/deploy',
          hint: 'Set `metadata.authProfile` on the SharePoint provider binding or map the target with an auth-backed binding.',
          detail: `Target: ${mapping.target}`,
        }
      ),
    ];
  }

  return [];
}

function resolvePowerBiDeployMappingDiagnostics(
  project: ProjectContext,
  parameter: ResolvedProjectParameter,
  mapping: ParameterMapping
): Diagnostic[] {
  const resolvedTarget = resolvePowerBiTarget(project, mapping.target, {
    expectedKind: 'powerbi-dataset',
    workspace: mapping.workspace,
  });

  if (!resolvedTarget.success) {
    return resolvedTarget.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      source: diagnostic.source ?? '@pp/deploy',
      detail: diagnostic.detail ?? `Deploy parameter ${parameter.name} could not resolve Power BI target ${mapping.target}.`,
    }));
  }

  if (!resolvedTarget.data?.authProfile) {
    return [
      createDiagnostic(
        'error',
        'DEPLOY_PREFLIGHT_POWERBI_AUTH_PROFILE_MISSING',
        `Deploy parameter ${parameter.name} maps to Power BI target ${mapping.target} without an auth profile.`,
        {
          source: '@pp/deploy',
          hint: 'Set `metadata.authProfile` on the Power BI provider binding or map the target with an auth-backed binding.',
          detail: `Target: ${mapping.target}`,
        }
      ),
    ];
  }

  return [];
}

function collectMissingMappingChecks(project: ProjectContext): DeployPreflightCheck[] {
  const checks: DeployPreflightCheck[] = [];

  for (const parameter of Object.values(project.parameters)) {
    if (parameter.hasValue) {
      continue;
    }

    for (const mapping of parameter.definition.mapsTo ?? []) {
      if (mapping.kind === 'dataverse-envvar') {
        checks.push({
          status: 'fail',
          code: 'DEPLOY_PREFLIGHT_ENVVAR_SOURCE_MISSING',
          message: `Deploy parameter ${parameter.name} is unresolved but maps to Dataverse environment variable ${mapping.target}.`,
          target: mapping.target,
          details: {
            parameter: parameter.name,
          },
        });
      } else if (mapping.kind === 'dataverse-envvar-create') {
        checks.push({
          status: 'fail',
          code: 'DEPLOY_PREFLIGHT_ENVVAR_CREATE_SOURCE_MISSING',
          message: `Deploy parameter ${parameter.name} is unresolved but maps to Dataverse environment variable create target ${mapping.target}.`,
          target: mapping.target,
          details: {
            parameter: parameter.name,
          },
        });
      } else if (mapping.kind === 'dataverse-connref') {
        checks.push({
          status: 'fail',
          code: 'DEPLOY_PREFLIGHT_CONNREF_SOURCE_MISSING',
          message: `Deploy parameter ${parameter.name} is unresolved but maps to Dataverse connection reference ${mapping.target}.`,
          target: mapping.target,
          details: {
            parameter: parameter.name,
          },
        });
      } else if (mapping.kind === 'dataverse-connref-create') {
        checks.push({
          status: 'fail',
          code: 'DEPLOY_PREFLIGHT_CONNREF_CREATE_SOURCE_MISSING',
          message: `Deploy parameter ${parameter.name} is unresolved but maps to Dataverse connection reference create target ${mapping.target}.`,
          target: mapping.target,
          details: {
            parameter: parameter.name,
          },
        });
      } else if (mapping.kind === 'deploy-input') {
        checks.push({
          status: 'fail',
          code: 'DEPLOY_PREFLIGHT_INPUT_SOURCE_MISSING',
          message: `Deploy parameter ${parameter.name} is unresolved but maps to deploy input ${mapping.target}.`,
          target: mapping.target,
          details: {
            parameter: parameter.name,
          },
        });
      } else if (mapping.kind === 'deploy-secret') {
        checks.push({
          status: 'fail',
          code: 'DEPLOY_PREFLIGHT_SECRET_SOURCE_MISSING',
          message: `Deploy parameter ${parameter.name} is unresolved but maps to deploy secret ${mapping.target}.`,
          target: mapping.target,
          details: {
            parameter: parameter.name,
          },
        });
      } else if (mapping.kind === 'flow-parameter') {
        checks.push({
          status: 'fail',
          code: 'DEPLOY_PREFLIGHT_FLOW_PARAMETER_SOURCE_MISSING',
          message: `Deploy parameter ${parameter.name} is unresolved but maps to flow parameter ${mapping.target}.`,
          target: mapping.target,
          details: {
            parameter: parameter.name,
            path: mapping.path,
          },
        });
      } else if (mapping.kind === 'flow-connref') {
        checks.push({
          status: 'fail',
          code: 'DEPLOY_PREFLIGHT_FLOW_CONNREF_SOURCE_MISSING',
          message: `Deploy parameter ${parameter.name} is unresolved but maps to flow connection reference ${mapping.target}.`,
          target: mapping.target,
          details: {
            parameter: parameter.name,
            path: mapping.path,
          },
        });
      } else if (mapping.kind === 'flow-envvar') {
        checks.push({
          status: 'fail',
          code: 'DEPLOY_PREFLIGHT_FLOW_ENVVAR_SOURCE_MISSING',
          message: `Deploy parameter ${parameter.name} is unresolved but maps to flow environment variable ${mapping.target}.`,
          target: mapping.target,
          details: {
            parameter: parameter.name,
            path: mapping.path,
          },
        });
      } else if (mapping.kind === 'sharepoint-file-text') {
        checks.push({
          status: 'fail',
          code: 'DEPLOY_PREFLIGHT_SHAREPOINT_SOURCE_MISSING',
          message: `Deploy parameter ${parameter.name} is unresolved but maps to SharePoint file ${mapping.target}.`,
          target: mapping.target,
          details: {
            parameter: parameter.name,
            site: mapping.site,
            drive: mapping.drive,
          },
        });
      } else if (mapping.kind === 'powerbi-dataset-refresh') {
        checks.push({
          status: 'fail',
          code: 'DEPLOY_PREFLIGHT_POWERBI_SOURCE_MISSING',
          message: `Deploy parameter ${parameter.name} is unresolved but maps to Power BI dataset ${mapping.target}.`,
          target: mapping.target,
          details: {
            parameter: parameter.name,
            workspace: mapping.workspace,
          },
        });
      }
    }
  }

  return checks;
}

function collectStaticMappingChecks(project: ProjectContext): DeployPreflightCheck[] {
  const checks: DeployPreflightCheck[] = [];

  for (const parameter of Object.values(project.parameters)) {
    for (const mapping of parameter.definition.mapsTo ?? []) {
      if (mapping.kind === 'flow-parameter' && !mapping.path) {
        checks.push({
          status: 'fail',
          code: 'DEPLOY_PREFLIGHT_FLOW_PARAMETER_PATH_MISSING',
          message: `Deploy parameter ${parameter.name} maps to flow parameter ${mapping.target} without a flow artifact path.`,
          target: mapping.target,
          details: {
            parameter: parameter.name,
          },
        });
      } else if (mapping.kind === 'flow-connref' && !mapping.path) {
        checks.push({
          status: 'fail',
          code: 'DEPLOY_PREFLIGHT_FLOW_CONNREF_PATH_MISSING',
          message: `Deploy parameter ${parameter.name} maps to flow connection reference ${mapping.target} without a flow artifact path.`,
          target: mapping.target,
          details: {
            parameter: parameter.name,
          },
        });
      } else if (mapping.kind === 'flow-envvar' && !mapping.path) {
        checks.push({
          status: 'fail',
          code: 'DEPLOY_PREFLIGHT_FLOW_ENVVAR_PATH_MISSING',
          message: `Deploy parameter ${parameter.name} maps to flow environment variable ${mapping.target} without a flow artifact path.`,
          target: mapping.target,
          details: {
            parameter: parameter.name,
          },
        });
      } else if (mapping.kind === 'sharepoint-file-text') {
        const diagnostics = resolveSharePointDeployMappingDiagnostics(project, parameter, mapping);

        for (const diagnostic of diagnostics) {
          checks.push({
            status: 'fail',
            code: diagnostic.code,
            message: diagnostic.message,
            target: mapping.target,
            details: {
              parameter: parameter.name,
            },
          });
        }
      } else if (mapping.kind === 'powerbi-dataset-refresh') {
        const diagnostics = resolvePowerBiDeployMappingDiagnostics(project, parameter, mapping);

        for (const diagnostic of diagnostics) {
          checks.push({
            status: 'fail',
            code: diagnostic.code,
            message: diagnostic.message,
            target: mapping.target,
            details: {
              parameter: parameter.name,
            },
          });
        }
      }
    }
  }

  return checks;
}

function collectExpectedPlanChecks(expectedPlan: DeployPlan | undefined, actualPlan: DeployPlan | undefined): DeployPreflightCheck[] {
  if (!expectedPlan || !actualPlan) {
    return [];
  }

  const mismatchedSections = diffComparableDeployPlans(expectedPlan, actualPlan);

  if (mismatchedSections.length === 0) {
    return [
      {
        status: 'pass',
        code: 'DEPLOY_PREFLIGHT_PLAN_MATCH',
        message: 'Saved deploy plan matches the current project resolution.',
      },
    ];
  }

  return [
    {
      status: 'fail',
      code: 'DEPLOY_PREFLIGHT_PLAN_MISMATCH',
      message: 'Saved deploy plan no longer matches the current project resolution.',
      details: {
        mismatchedSections,
      },
    },
  ];
}

function collectSavedPlanMissingChecks(plan: DeployPlan): DeployPreflightCheck[] {
  const checks: DeployPreflightCheck[] = [];

  for (const input of plan.inputs) {
    if (input.hasValue) {
      continue;
    }

    for (const mapping of input.mappings) {
      if (mapping.kind === 'dataverse-envvar') {
        checks.push({
          status: 'fail',
          code: 'DEPLOY_PREFLIGHT_ENVVAR_SOURCE_MISSING',
          message: `Saved deploy plan input ${input.name} is unresolved but maps to Dataverse environment variable ${mapping.target}.`,
          target: mapping.target,
          details: {
            parameter: input.name,
          },
        });
      } else if (mapping.kind === 'dataverse-envvar-create') {
        checks.push({
          status: 'fail',
          code: 'DEPLOY_PREFLIGHT_ENVVAR_CREATE_SOURCE_MISSING',
          message: `Saved deploy plan input ${input.name} is unresolved but maps to Dataverse environment variable create target ${mapping.target}.`,
          target: mapping.target,
          details: {
            parameter: input.name,
          },
        });
      } else if (mapping.kind === 'dataverse-connref') {
        checks.push({
          status: 'fail',
          code: 'DEPLOY_PREFLIGHT_CONNREF_SOURCE_MISSING',
          message: `Saved deploy plan input ${input.name} is unresolved but maps to Dataverse connection reference ${mapping.target}.`,
          target: mapping.target,
          details: {
            parameter: input.name,
          },
        });
      } else if (mapping.kind === 'dataverse-connref-create') {
        checks.push({
          status: 'fail',
          code: 'DEPLOY_PREFLIGHT_CONNREF_CREATE_SOURCE_MISSING',
          message: `Saved deploy plan input ${input.name} is unresolved but maps to Dataverse connection reference create target ${mapping.target}.`,
          target: mapping.target,
          details: {
            parameter: input.name,
          },
        });
      } else if (mapping.kind === 'deploy-input') {
        checks.push({
          status: 'fail',
          code: 'DEPLOY_PREFLIGHT_INPUT_SOURCE_MISSING',
          message: `Saved deploy plan input ${input.name} is unresolved but maps to deploy input ${mapping.target}.`,
          target: mapping.target,
          details: {
            parameter: input.name,
          },
        });
      } else if (mapping.kind === 'deploy-secret') {
        checks.push({
          status: 'fail',
          code: 'DEPLOY_PREFLIGHT_SECRET_SOURCE_MISSING',
          message: `Saved deploy plan input ${input.name} is unresolved but maps to deploy secret ${mapping.target}.`,
          target: mapping.target,
          details: {
            parameter: input.name,
          },
        });
      } else if (mapping.kind === 'flow-parameter') {
        checks.push({
          status: 'fail',
          code: 'DEPLOY_PREFLIGHT_FLOW_PARAMETER_SOURCE_MISSING',
          message: `Saved deploy plan input ${input.name} is unresolved but maps to flow parameter ${mapping.target}.`,
          target: mapping.target,
          details: {
            parameter: input.name,
          },
        });
      } else if (mapping.kind === 'flow-connref') {
        checks.push({
          status: 'fail',
          code: 'DEPLOY_PREFLIGHT_FLOW_CONNREF_SOURCE_MISSING',
          message: `Saved deploy plan input ${input.name} is unresolved but maps to flow connection reference ${mapping.target}.`,
          target: mapping.target,
          details: {
            parameter: input.name,
          },
        });
      } else if (mapping.kind === 'flow-envvar') {
        checks.push({
          status: 'fail',
          code: 'DEPLOY_PREFLIGHT_FLOW_ENVVAR_SOURCE_MISSING',
          message: `Saved deploy plan input ${input.name} is unresolved but maps to flow environment variable ${mapping.target}.`,
          target: mapping.target,
          details: {
            parameter: input.name,
          },
        });
      } else if (mapping.kind === 'sharepoint-file-text') {
        checks.push({
          status: 'fail',
          code: 'DEPLOY_PREFLIGHT_SHAREPOINT_SOURCE_MISSING',
          message: `Saved deploy plan input ${input.name} is unresolved but maps to SharePoint file ${mapping.target}.`,
          target: mapping.target,
          details: {
            parameter: input.name,
          },
        });
      } else if (mapping.kind === 'powerbi-dataset-refresh') {
        checks.push({
          status: 'fail',
          code: 'DEPLOY_PREFLIGHT_POWERBI_SOURCE_MISSING',
          message: `Saved deploy plan input ${input.name} is unresolved but maps to Power BI dataset ${mapping.target}.`,
          target: mapping.target,
          details: {
            parameter: input.name,
          },
        });
      }
    }
  }

  return checks;
}

function collectSavedPlanValueChecks(
  plan: DeployPlan,
  parameterOverrides: Record<string, DeployPrimitiveValue> = {}
): DeployPreflightCheck[] {
  return prepareSavedPlanOperations(plan, parameterOverrides)
    .filter((operation) => !operation.executable && operation.blockedCode && operation.blockedMessage)
    .map((operation) => ({
      status: 'fail' as const,
      code: operation.blockedCode!,
      message: operation.blockedMessage!,
      target: operation.plan.target,
      details: {
        parameter: operation.plan.parameter,
        operationKind: operation.plan.kind,
      },
    }));
}

function finalizeDeployExecution(
  mode: DeployExecutionMode,
  target: DeployTarget,
  plan: DeployPlan | undefined,
  bindings: DeployBindingSummary,
  confirmation: DeployConfirmation,
  checks: DeployPreflightCheck[],
  operations: DeployOperationResult[],
  startedAt: number
): DeployExecutionResult {
  const finishedAt = Date.now();
  const normalizedPlan: DeployPlan =
    plan ??
    ({
      projectRoot: '',
      generatedAt: new Date(startedAt).toISOString(),
      executionStages: ['resolve', 'preflight', 'plan', 'apply', 'report'],
      supportedAdapters: ['github-actions', 'azure-devops', 'power-platform-pipelines'],
      target,
      inputs: [],
      providerBindings: [],
      topology: [],
      templateRegistries: [],
      build: {},
      assets: [],
      bindings,
      operations: [],
    } as DeployPlan);
  const summary = summarizeApplyOperations(operations);

  return {
    mode,
    target,
    plan: normalizedPlan,
    bindings: plan?.bindings ?? bindings,
    confirmation,
    preflight: {
      ok: checks.every((check) => check.status !== 'fail'),
      checks,
    },
    apply: {
      summary,
      operations,
    },
    report: {
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs: mode === 'apply' ? finishedAt - startedAt : 0,
    },
  };
}

function summarizeApplyOperations(operations: DeployOperationResult[]): DeployApplySummary {
  return operations.reduce<DeployApplySummary>(
    (summary, operation) => {
      if (operation.status === 'applied') {
        summary.applied += 1;
      } else if (operation.status === 'failed') {
        summary.failed += 1;
      } else if (operation.status === 'skipped') {
        summary.skipped += 1;
      } else if (operation.status === 'resolved') {
        summary.resolved += 1;
      }

      if (operation.changed) {
        summary.changed += 1;
      }

      if (operation.created) {
        summary.created += 1;
      }

      if (operation.status !== 'planned') {
        summary.attempted += 1;
      } else if (operation.targetExists !== false) {
        summary.skipped += 1;
      }

      return summary;
    },
    {
      attempted: 0,
      applied: 0,
      created: 0,
      failed: 0,
      skipped: 0,
      changed: 0,
      resolved: 0,
    }
  );
}

async function createAuthenticatedProviderClient<TClient>(
  baseUrl: string,
  authProfileName: string,
  createClient: (httpClient: HttpClient) => TClient
): Promise<OperationResult<TClient>> {
  const auth = new AuthService();
  const profileResult = await auth.getProfile(authProfileName);

  if (!profileResult.success) {
    return profileResult as unknown as OperationResult<TClient>;
  }

  if (!profileResult.data) {
    return {
      success: false,
      diagnostics: [
        createDiagnostic('error', 'AUTH_PROFILE_NOT_FOUND', `Auth profile ${authProfileName} was not found.`, {
          source: '@pp/deploy',
        }),
      ],
      warnings: [],
      supportTier: 'preview',
    };
  }

  const tokenProviderResult = createTokenProvider(profileResult.data);

  if (!tokenProviderResult.success || !tokenProviderResult.data) {
    return tokenProviderResult as unknown as OperationResult<TClient>;
  }

  return ok(createClient(new HttpClient({ baseUrl, tokenProvider: tokenProviderResult.data })), {
    supportTier: tokenProviderResult.supportTier,
    diagnostics: [...profileResult.diagnostics, ...tokenProviderResult.diagnostics],
    warnings: [...(profileResult.warnings ?? []), ...(tokenProviderResult.warnings ?? [])],
  });
}

function isDataverseEnvvarOperation(operation: DeployOperationPlan): operation is DataverseEnvvarDeployOperationPlan {
  return operation.kind === 'dataverse-envvar-set';
}

function isDataverseEnvvarUpsertOperation(operation: DeployOperationPlan): operation is DataverseEnvvarUpsertDeployOperationPlan {
  return operation.kind === 'dataverse-envvar-upsert';
}

function isDataverseConnectionReferenceOperation(
  operation: DeployOperationPlan
): operation is DataverseConnectionReferenceDeployOperationPlan {
  return operation.kind === 'dataverse-connref-set';
}

function isDataverseConnectionReferenceUpsertOperation(
  operation: DeployOperationPlan
): operation is DataverseConnectionReferenceUpsertDeployOperationPlan {
  return operation.kind === 'dataverse-connref-upsert';
}

function isFlowParameterOperation(operation: DeployOperationPlan): operation is FlowParameterDeployOperationPlan {
  return operation.kind === 'flow-parameter-set';
}

function isFlowConnectionReferenceOperation(
  operation: DeployOperationPlan
): operation is FlowConnectionReferenceDeployOperationPlan {
  return operation.kind === 'flow-connref-set';
}

function isFlowEnvironmentVariableOperation(operation: DeployOperationPlan): operation is FlowEnvironmentVariableDeployOperationPlan {
  return operation.kind === 'flow-envvar-set';
}

function isSharePointFileTextOperation(operation: DeployOperationPlan): operation is SharePointFileTextDeployOperationPlan {
  return operation.kind === 'sharepoint-file-text-set';
}

function isPowerBiDatasetRefreshOperation(operation: DeployOperationPlan): operation is PowerBiDatasetRefreshDeployOperationPlan {
  return operation.kind === 'powerbi-dataset-refresh';
}

function isDataverseMutationOperation(
  operation: DeployOperationPlan
): operation is
  | DataverseEnvvarDeployOperationPlan
  | DataverseEnvvarUpsertDeployOperationPlan
  | DataverseConnectionReferenceDeployOperationPlan
  | DataverseConnectionReferenceUpsertDeployOperationPlan {
  return (
    isDataverseEnvvarOperation(operation) ||
    isDataverseEnvvarUpsertOperation(operation) ||
    isDataverseConnectionReferenceOperation(operation) ||
    isDataverseConnectionReferenceUpsertOperation(operation)
  );
}

function resolveDeployConfirmation(mode: DeployExecutionMode, confirmed: boolean): DeployConfirmation {
  if (mode !== 'apply') {
    return {
      required: false,
      confirmed,
      status: 'not-required',
    };
  }

  return {
    required: true,
    confirmed,
    status: confirmed ? 'confirmed' : 'blocked',
  };
}

function stringifyDeployValue(value: string | number | boolean): string {
  return typeof value === 'string' ? value : String(value);
}

function stringifyDeployArtifactValue(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value);
}

function isDeployValueRedacted(value: string | number | boolean): value is string {
  return typeof value === 'string' && value === '<redacted>';
}

function resolveOperationEnvironmentAlias(operation: DeployOperationPlan, fallbackEnvironmentAlias?: string): string | undefined {
  return operation.environmentAlias ?? fallbackEnvironmentAlias;
}

function resolveOperationSolutionUniqueName(operation: DeployOperationPlan, fallbackSolutionUniqueName?: string): string | undefined {
  return operation.solutionUniqueName ?? fallbackSolutionUniqueName;
}

function inferEnvironmentVariableType(value: string | number | boolean): 'string' | 'number' | 'boolean' {
  if (typeof value === 'number') {
    return 'number';
  }

  if (typeof value === 'boolean') {
    return 'boolean';
  }

  return 'string';
}

function resolveDeployMappingSolutionTarget(
  project: ProjectContext,
  solutionAlias: string | undefined
): ProjectContext['topology']['activeSolution'] | ProjectContext['topology']['stages'][string]['solutions'][string] | undefined {
  if (!solutionAlias) {
    return project.topology.activeSolution;
  }

  const activeStage = project.topology.selectedStage ? project.topology.stages[project.topology.selectedStage] : undefined;

  if (activeStage?.solutions[solutionAlias]) {
    return activeStage.solutions[solutionAlias];
  }

  for (const stage of Object.values(project.topology.stages)) {
    if (stage.solutions[solutionAlias]) {
      return stage.solutions[solutionAlias];
    }
  }

  return undefined;
}

function resolveDeployMappingTarget(project: ProjectContext, mapping: ParameterMapping): ResolvedDeployMappingTarget {
  const resolvedSolution = resolveDeployMappingSolutionTarget(project, mapping.solution);

  if (mapping.solution) {
    return {
      environmentAlias: mapping.environment ?? resolvedSolution?.environment ?? project.topology.activeEnvironment,
      solutionAlias: resolvedSolution?.alias ?? mapping.solution,
      solutionUniqueName: resolvedSolution?.uniqueName,
    };
  }

  return {
    environmentAlias: mapping.environment ?? resolvedSolution?.environment ?? project.topology.activeEnvironment,
    solutionAlias: resolvedSolution?.alias ?? project.topology.activeSolution?.alias,
    solutionUniqueName: resolvedSolution?.uniqueName ?? project.topology.activeSolution?.uniqueName,
  };
}

function resolveDeployFlowPath(project: ProjectContext, path: string): string {
  return resolvePath(project.root, path);
}

function resolveDeployEnvironmentVariableCreateOptions(mapping: ParameterMapping): DeployEnvironmentVariableCreateOptions | undefined {
  if (mapping.kind !== 'dataverse-envvar-create') {
    return undefined;
  }

  const options: DeployEnvironmentVariableCreateOptions = {
    displayName: mapping.displayName,
    defaultValue:
      mapping.defaultValue === undefined
        ? undefined
        : typeof mapping.defaultValue === 'string'
          ? mapping.defaultValue
          : String(mapping.defaultValue),
    type: mapping.type,
    valueSchema: mapping.valueSchema,
    secretStore: mapping.secretStore,
  };

  return Object.values(options).some((value) => value !== undefined) ? options : undefined;
}

function resolveDeployConnectionReferenceCreateOptions(mapping: ParameterMapping): DeployConnectionReferenceCreateOptions | undefined {
  if (mapping.kind !== 'dataverse-connref-create') {
    return undefined;
  }

  const options: DeployConnectionReferenceCreateOptions = {
    displayName: mapping.displayName,
    connectorId: mapping.connectorId,
    customConnectorId: mapping.customConnectorId,
  };

  return Object.values(options).some((value) => value !== undefined) ? options : undefined;
}

function toEnvironmentVariableCreateOptions(
  options: DeployEnvironmentVariableCreateOptions | undefined
): Omit<EnvironmentVariableCreateOptions, 'solutionUniqueName'> {
  if (!options) {
    return {};
  }

  return {
    displayName: options.displayName,
    defaultValue: options.defaultValue,
    type: options.type,
    valueSchema: options.valueSchema,
    secretStore: options.secretStore,
  };
}

function toConnectionReferenceCreateOptions(
  options: DeployConnectionReferenceCreateOptions | undefined
): Omit<ConnectionReferenceCreateOptions, 'solutionUniqueName'> {
  if (!options) {
    return {};
  }

  return {
    displayName: options.displayName,
    connectorId: options.connectorId,
    customConnectorId: options.customConnectorId,
  };
}

function resolveInvalidEnvironmentVariableCreateType(type: string | number | undefined): string | number | undefined {
  if (type === undefined) {
    return undefined;
  }

  if (typeof type === 'number') {
    return Number.isInteger(type) ? undefined : type;
  }

  const normalized = String(type)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');

  return SUPPORTED_ENVIRONMENT_VARIABLE_TYPE_ALIASES.has(normalized) ? undefined : type;
}

function resolveMissingConnectionReferenceConnector(options: DeployConnectionReferenceCreateOptions | undefined): boolean {
  return !options?.connectorId && !options?.customConnectorId;
}

function normalizeEnvironmentVariableTypeForComparison(type: string | number | undefined): string | undefined {
  if (type === undefined) {
    return undefined;
  }

  const normalized = String(type)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');

  switch (normalized) {
    case '100000000':
    case 'string':
    case 'text':
      return 'string';
    case '100000001':
    case 'number':
    case 'decimal':
      return 'number';
    case '100000002':
    case 'boolean':
    case 'bool':
    case 'two-options':
    case 'yes-no':
      return 'boolean';
    case '100000003':
    case 'json':
      return 'json';
    case '100000004':
    case 'data-source':
    case 'datasource':
      return 'data-source';
    case '100000005':
    case 'secret':
      return 'secret';
    default:
      return normalized;
  }
}

function resolveEnvironmentVariableCreateMetadataMismatch(
  variable: EnvironmentVariableSummary,
  options: DeployEnvironmentVariableCreateOptions | undefined
): DeployMetadataMismatch | undefined {
  if (!options) {
    return undefined;
  }

  const mismatchedFields: string[] = [];
  const expected: Record<string, unknown> = {};
  const actual: Record<string, unknown> = {};

  if (options.displayName !== undefined && options.displayName !== variable.displayName) {
    mismatchedFields.push('displayName');
    expected.displayName = options.displayName;
    actual.displayName = variable.displayName;
  }

  if (options.defaultValue !== undefined && options.defaultValue !== variable.defaultValue) {
    mismatchedFields.push('defaultValue');
    expected.defaultValue = options.defaultValue;
    actual.defaultValue = variable.defaultValue;
  }

  if (options.valueSchema !== undefined && options.valueSchema !== variable.valueSchema) {
    mismatchedFields.push('valueSchema');
    expected.valueSchema = options.valueSchema;
    actual.valueSchema = variable.valueSchema;
  }

  if (options.secretStore !== undefined && options.secretStore !== variable.secretStore) {
    mismatchedFields.push('secretStore');
    expected.secretStore = options.secretStore;
    actual.secretStore = variable.secretStore;
  }

  if (options.type !== undefined) {
    const expectedType = normalizeEnvironmentVariableTypeForComparison(options.type);
    const actualType = normalizeEnvironmentVariableTypeForComparison(variable.type);

    if (expectedType !== actualType) {
      mismatchedFields.push('type');
      expected.type = options.type;
      actual.type = variable.type;
    }
  }

  return mismatchedFields.length > 0
    ? {
        mismatchedFields,
        expected,
        actual,
      }
    : undefined;
}

function resolveConnectionReferenceCreateMetadataMismatch(
  reference: ConnectionReferenceSummary,
  options: DeployConnectionReferenceCreateOptions | undefined
): DeployMetadataMismatch | undefined {
  if (!options) {
    return undefined;
  }

  const mismatchedFields: string[] = [];
  const expected: Record<string, unknown> = {};
  const actual: Record<string, unknown> = {};

  if (options.displayName !== undefined && options.displayName !== reference.displayName) {
    mismatchedFields.push('displayName');
    expected.displayName = options.displayName;
    actual.displayName = reference.displayName;
  }

  if (options.connectorId !== undefined && options.connectorId !== reference.connectorId) {
    mismatchedFields.push('connectorId');
    expected.connectorId = options.connectorId;
    actual.connectorId = reference.connectorId;
  }

  if (options.customConnectorId !== undefined && options.customConnectorId !== reference.customConnectorId) {
    mismatchedFields.push('customConnectorId');
    expected.customConnectorId = options.customConnectorId;
    actual.customConnectorId = reference.customConnectorId;
  }

  return mismatchedFields.length > 0
    ? {
        mismatchedFields,
        expected,
        actual,
      }
    : undefined;
}

function diffComparableDeployPlans(expectedPlan: DeployPlan, actualPlan: DeployPlan): string[] {
  const expectedComparable = toComparableDeployPlan(expectedPlan);
  const actualComparable = toComparableDeployPlan(actualPlan);
  const mismatchedSections: string[] = [];

  for (const section of Object.keys(expectedComparable) as Array<keyof ComparableDeployPlan>) {
    if (!isDeepStrictEqual(expectedComparable[section], actualComparable[section])) {
      mismatchedSections.push(section);
    }
  }

  return mismatchedSections;
}

function toComparableDeployPlan(plan: DeployPlan): ComparableDeployPlan {
  return stripUndefinedDeep({
    executionStages: plan.executionStages,
    supportedAdapters: plan.supportedAdapters,
    defaultEnvironment: plan.defaultEnvironment,
    defaultSolution: plan.defaultSolution,
    selectedStage: plan.selectedStage,
    activeEnvironment: plan.activeEnvironment,
    activeSolution: plan.activeSolution,
    target: plan.target,
    inputs: plan.inputs,
    providerBindings: plan.providerBindings,
    topology: plan.topology,
    templateRegistries: plan.templateRegistries,
    build: plan.build,
    bindings: plan.bindings,
    operations: plan.operations,
  }) as ComparableDeployPlan;
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => stripUndefinedDeep(entry)) as T;
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, stripUndefinedDeep(entry)])
  ) as T;
}

export function resolveDeployBindings(project: ProjectContext): ResolvedDeployBindings {
  const inputs: ResolvedDeployBindingEntry[] = [];
  const secrets: ResolvedDeployBindingEntry[] = [];

  for (const parameter of Object.values(project.parameters)) {
    for (const mapping of parameter.definition.mapsTo ?? []) {
      if (mapping.kind !== 'deploy-input' && mapping.kind !== 'deploy-secret') {
        continue;
      }

      const entry: ResolvedDeployBindingEntry = {
        kind: mapping.kind,
        parameter: parameter.name,
        source: parameter.source,
        sensitive: parameter.sensitive,
        target: mapping.target,
        status: parameter.hasValue && parameter.value !== undefined ? 'resolved' : 'missing',
        reference: parameter.reference,
        valuePreview: parameter.sensitive ? '<redacted>' : parameter.value,
        value: parameter.hasValue ? parameter.value : undefined,
      };

      if (mapping.kind === 'deploy-secret') {
        secrets.push(entry);
      } else {
        inputs.push(entry);
      }
    }
  }

  const conflicts = analyzeDeployTargetConflicts(
    [...inputs, ...secrets].map((entry) => ({
      kind: entry.kind === 'deploy-secret' ? ('deploy-secret-bind' as const) : ('deploy-input-bind' as const),
      parameter: entry.parameter,
      source: entry.source,
      sensitive: entry.sensitive,
      target: entry.target,
      valuePreview: entry.valuePreview,
    }))
  );

  for (const entry of [...inputs, ...secrets]) {
    if (entry.status !== 'resolved') {
      continue;
    }

    if (
      conflicts.some((conflict) =>
        matchesDeployConflict(
          {
            kind: entry.kind === 'deploy-secret' ? 'deploy-secret-bind' : 'deploy-input-bind',
            parameter: entry.parameter,
            source: entry.source,
            sensitive: entry.sensitive,
            target: entry.target,
            valuePreview: entry.valuePreview,
          },
          conflict
        )
      )
    ) {
      entry.status = 'conflict';
    }
  }

  return {
    inputs,
    secrets,
  };
}

function summarizeResolvedDeployBindings(bindings: ResolvedDeployBindings): DeployBindingSummary {
  return {
    inputs: bindings.inputs.map(({ value: _value, ...entry }) => entry),
    secrets: bindings.secrets.map(({ value: _value, ...entry }) => entry),
  };
}

function applySavedPlanParameterOverrides(
  plan: DeployPlan,
  parameterOverrides: Record<string, DeployPrimitiveValue> = {}
): DeployPlan {
  if (Object.keys(parameterOverrides).length === 0) {
    return plan;
  }

  return {
    ...plan,
    inputs: plan.inputs.map((input) => {
      if (!Object.hasOwn(parameterOverrides, input.name)) {
        return input;
      }

      const override = parameterOverrides[input.name]!;

      return {
        ...input,
        source: 'value',
        hasValue: true,
        value: input.sensitive ? '<redacted>' : override,
      };
    }),
    bindings: {
      inputs: plan.bindings.inputs.map((binding) => applySavedPlanBindingOverride(binding, parameterOverrides)),
      secrets: plan.bindings.secrets.map((binding) => applySavedPlanBindingOverride(binding, parameterOverrides)),
    },
    operations: plan.operations.map((operation) => {
      if (!Object.hasOwn(parameterOverrides, operation.parameter)) {
        return operation;
      }

      return applySavedPlanOperationOverride(operation, parameterOverrides[operation.parameter]!);
    }),
  };
}

function applySavedPlanBindingOverride(
  binding: DeployBindingSummaryEntry,
  parameterOverrides: Record<string, DeployPrimitiveValue>
): DeployBindingSummaryEntry {
  if (!Object.hasOwn(parameterOverrides, binding.parameter)) {
    return binding;
  }

  return {
    ...binding,
    source: 'value',
    status: 'resolved',
    valuePreview: binding.sensitive ? '<redacted>' : parameterOverrides[binding.parameter]!,
  };
}

function applySavedPlanOperationOverride(
  operation: DeployOperationPlan,
  value: DeployPrimitiveValue
): DeployOperationPlan {
  return {
    ...operation,
    source: 'value',
    valuePreview: operation.sensitive ? '<redacted>' : value,
  };
}

function groupPreparedDataverseOperations(
  operations: PreparedDeployOperation[],
  target: DeployTarget
): Array<{ environmentAlias: string; solutionUniqueName: string; operations: PreparedDeployOperation[] }> {
  const grouped = new Map<string, { environmentAlias: string; solutionUniqueName: string; operations: PreparedDeployOperation[] }>();

  for (const operation of operations) {
    const environmentAlias = resolveOperationEnvironmentAlias(operation.plan, target.environmentAlias);
    const solutionUniqueName = resolveOperationSolutionUniqueName(operation.plan, target.solutionUniqueName);

    if (!environmentAlias || !solutionUniqueName) {
      continue;
    }

    const key = `${environmentAlias.toLowerCase()}::${solutionUniqueName.toLowerCase()}`;
    const existing = grouped.get(key);

    if (existing) {
      existing.operations.push(operation);
      continue;
    }

    grouped.set(key, {
      environmentAlias,
      solutionUniqueName,
      operations: [operation],
    });
  }

  return [...grouped.values()];
}

function groupPreparedFlowOperationsByTarget(
  operations: PreparedDeployOperation[],
  target: DeployTarget
): Array<{ environmentAlias: string; solutionUniqueName: string; operations: PreparedDeployOperation[] }> {
  return groupPreparedDataverseOperations(operations, target);
}

async function inspectDeploySolutionTarget(
  environmentAlias: string,
  solutionUniqueName: string
): Promise<DeploySolutionTargetInspection> {
  const diagnostics: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  const checks: DeployPreflightCheck[] = [];
  const resolution = await resolveDataverseClient(environmentAlias);

  if (!resolution.success || !resolution.data) {
    diagnostics.push(...resolution.diagnostics);
    warnings.push(...resolution.warnings);
    checks.push({
      status: 'fail',
      code: 'DEPLOY_PREFLIGHT_DATAVERSE_RESOLUTION_FAILED',
      message: `Could not resolve Dataverse environment alias ${environmentAlias}.`,
      target: environmentAlias,
      details: {
        solution: solutionUniqueName,
      },
    });
    return {
      environmentAlias,
      solutionUniqueName,
      checks,
      diagnostics,
      warnings,
      solutionFound: false,
      references: [],
      variables: [],
      referenceByLogicalName: new Map(),
      variableBySchema: new Map(),
    };
  }

  const solutionService = new SolutionService(resolution.data.client);
  const connectionReferences = new ConnectionReferenceService(resolution.data.client);
  const environmentVariables = new EnvironmentVariableService(resolution.data.client);
  const [analysis, references, variables] = await Promise.all([
    solutionService.analyze(solutionUniqueName),
    connectionReferences.list({ solutionUniqueName }),
    environmentVariables.list({ solutionUniqueName }),
  ]);

  if (!analysis.success) {
    diagnostics.push(...analysis.diagnostics);
    warnings.push(...analysis.warnings);
    checks.push({
      status: 'fail',
      code: 'DEPLOY_PREFLIGHT_SOLUTION_ANALYZE_FAILED',
      message: `Failed to analyze solution ${solutionUniqueName} before deploy.`,
      target: solutionUniqueName,
    });
  }

  if (!variables.success) {
    diagnostics.push(...variables.diagnostics);
    warnings.push(...variables.warnings);
    checks.push({
      status: 'fail',
      code: 'DEPLOY_PREFLIGHT_ENVVAR_DISCOVERY_FAILED',
      message: `Failed to inspect environment variables for solution ${solutionUniqueName}.`,
      target: solutionUniqueName,
    });
  }

  if (!references.success) {
    diagnostics.push(...references.diagnostics);
    warnings.push(...references.warnings);
    checks.push({
      status: 'fail',
      code: 'DEPLOY_PREFLIGHT_CONNREF_DISCOVERY_FAILED',
      message: `Failed to inspect connection references for solution ${solutionUniqueName}.`,
      target: solutionUniqueName,
    });
  }

  const solutionAnalysis = analysis.success ? analysis.data : undefined;
  const discoveredReferences: ConnectionReferenceSummary[] = references.success ? references.data ?? [] : [];
  const discoveredVariables: EnvironmentVariableSummary[] = variables.success ? variables.data ?? [] : [];
  const referenceByLogicalName = new Map(
    discoveredReferences
      .filter((reference) => reference.logicalName)
      .map((reference) => [reference.logicalName!.toLowerCase(), reference] as const)
  );
  const variableBySchema = new Map(
    discoveredVariables
      .filter((variable) => variable.schemaName)
      .map((variable) => [variable.schemaName!.toLowerCase(), variable] as const)
  );

  let solutionFound = false;

  if (analysis.success) {
    if (!solutionAnalysis) {
      checks.push({
        status: 'fail',
        code: 'DEPLOY_PREFLIGHT_SOLUTION_NOT_FOUND',
        message: `Solution ${solutionUniqueName} was not found in ${environmentAlias}.`,
        target: solutionUniqueName,
      });
    } else {
      solutionFound = true;
      checks.push({
        status: 'pass',
        code: 'DEPLOY_PREFLIGHT_SOLUTION_FOUND',
        message: `Solution ${solutionUniqueName} is available in ${environmentAlias}.`,
        target: solutionUniqueName,
      });

      if (solutionAnalysis.invalidConnectionReferences.length > 0) {
        checks.push({
          status: 'warn',
          code: 'DEPLOY_PREFLIGHT_CONNECTION_REFS_INVALID',
          message: `Solution ${solutionUniqueName} has ${solutionAnalysis.invalidConnectionReferences.length} invalid connection reference(s).`,
          target: solutionUniqueName,
        });
      }

      if (solutionAnalysis.missingEnvironmentVariables.length > 0) {
        checks.push({
          status: 'warn',
          code: 'DEPLOY_PREFLIGHT_ENVVARS_MISSING_VALUES',
          message: `Solution ${solutionUniqueName} has ${solutionAnalysis.missingEnvironmentVariables.length} environment variable(s) without an effective value.`,
          target: solutionUniqueName,
        });
      }

      if (solutionAnalysis.modelDriven.summary.appCount > 0) {
        checks.push({
          status: solutionAnalysis.modelDriven.summary.missingArtifactCount > 0 ? 'warn' : 'pass',
          code:
            solutionAnalysis.modelDriven.summary.missingArtifactCount > 0
              ? 'DEPLOY_PREFLIGHT_MODEL_DRIVEN_MISSING_COMPONENTS'
              : 'DEPLOY_PREFLIGHT_MODEL_DRIVEN_READY',
          message:
            solutionAnalysis.modelDriven.summary.missingArtifactCount > 0
              ? `Model-driven apps in solution ${solutionUniqueName} have ${solutionAnalysis.modelDriven.summary.missingArtifactCount} missing composition artifact(s).`
              : `Model-driven apps in solution ${solutionUniqueName} were analyzed without missing composition artifacts.`,
          target: solutionUniqueName,
          details: {
            appCount: solutionAnalysis.modelDriven.summary.appCount,
          },
        });
      }
    }
  }

  return {
    environmentAlias,
    solutionUniqueName,
    checks,
    diagnostics,
    warnings,
    solutionFound,
    solutionAnalysis,
    references: discoveredReferences,
    variables: discoveredVariables,
    referenceByLogicalName,
    variableBySchema,
  };
}

function projectFlowArtifactRemoteTargets(
  artifact: FlowArtifact,
  operations: PreparedDeployOperation[]
): {
  connectionReferences: Array<{ artifactReference: string; projectedLogicalName: string }>;
  environmentVariables: Array<{ artifactVariable: string; projectedSchemaName: string }>;
} {
  const connectionReferenceOverrides = new Map<string, string>();
  const environmentVariableOverrides = new Map<string, string>();

  for (const operation of operations) {
    if (
      isPreparedFlowConnectionReferenceOperation(operation) &&
      operation.executable &&
      operation.value !== undefined &&
      !isDeployValueRedacted(operation.value)
    ) {
      connectionReferenceOverrides.set(operation.plan.target, stringifyDeployValue(operation.value));
    }

    if (
      isPreparedFlowEnvironmentVariableOperation(operation) &&
      operation.executable &&
      operation.value !== undefined &&
      !isDeployValueRedacted(operation.value)
    ) {
      environmentVariableOverrides.set(operation.plan.target, stringifyDeployValue(operation.value));
    }
  }

  const connectionReferences = artifact.metadata.connectionReferences
    .map((reference) => ({
      artifactReference: reference.name,
      projectedLogicalName:
        connectionReferenceOverrides.get(reference.name) ?? reference.connectionReferenceLogicalName ?? reference.name,
    }))
    .filter((reference) => reference.projectedLogicalName);
  const environmentVariables = artifact.metadata.environmentVariables
    .map((variable) => ({
      artifactVariable: variable,
      projectedSchemaName: environmentVariableOverrides.get(variable) ?? variable,
    }))
    .filter((variable) => variable.projectedSchemaName);

  return {
    connectionReferences: dedupeProjectedFlowTargets(connectionReferences, (entry) => entry.projectedLogicalName.toLowerCase()),
    environmentVariables: dedupeProjectedFlowTargets(environmentVariables, (entry) => entry.projectedSchemaName.toLowerCase()),
  };
}

function dedupeProjectedFlowTargets<T>(entries: T[], getKey: (entry: T) => string): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const entry of entries) {
    const key = getKey(entry);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(entry);
  }

  return deduped;
}

function analyzeDeployTargetConflicts(operations: DeployOperationPlan[]): DeployTargetConflict[] {
  const grouped = new Map<string, DeployOperationPlan[]>();

  for (const operation of operations) {
    const key = getDeployConflictKey(operation);
    const existing = grouped.get(key);

    if (existing) {
      existing.push(operation);
    } else {
      grouped.set(key, [operation]);
    }
  }

  const conflicts: DeployTargetConflict[] = [];

  for (const [, groupedOperations] of grouped) {
    if (groupedOperations.length < 2) {
      continue;
    }

    const sample = groupedOperations[0]!;
    const parameters = [...new Set(groupedOperations.map((operation) => operation.parameter))];
    const operationKinds = [...new Set(groupedOperations.map((operation) => operation.kind))];
    const parameterList = parameters.join(', ');

    if (isDataverseEnvvarOperation(sample) || isDataverseEnvvarUpsertOperation(sample)) {
      conflicts.push({
        code: 'DEPLOY_PREFLIGHT_ENVVAR_TARGET_CONFLICT',
        message: `Environment variable ${sample.target} has conflicting deploy mappings from ${parameterList}.`,
        details: {
          target: sample.target,
          parameters,
          operationKinds,
        },
      });
      continue;
    }

    if (isDataverseConnectionReferenceOperation(sample) || isDataverseConnectionReferenceUpsertOperation(sample)) {
      conflicts.push({
        code: 'DEPLOY_PREFLIGHT_CONNREF_TARGET_CONFLICT',
        message: `Connection reference ${sample.target} has conflicting deploy mappings from ${parameterList}.`,
        details: {
          target: sample.target,
          parameters,
          operationKinds,
        },
      });
      continue;
    }

    if (isFlowParameterOperation(sample)) {
      conflicts.push({
        code: 'DEPLOY_PREFLIGHT_FLOW_PARAMETER_TARGET_CONFLICT',
        message: `Flow parameter ${sample.target} in ${sample.path} has conflicting deploy mappings from ${parameterList}.`,
        details: {
          target: sample.target,
          parameters,
          operationKinds,
        },
      });
      continue;
    }

    if (isFlowConnectionReferenceOperation(sample)) {
      conflicts.push({
        code: 'DEPLOY_PREFLIGHT_FLOW_CONNREF_TARGET_CONFLICT',
        message: `Flow connection reference ${sample.target} in ${sample.path} has conflicting deploy mappings from ${parameterList}.`,
        details: {
          target: sample.target,
          parameters,
          operationKinds,
        },
      });
      continue;
    }

    if (isFlowEnvironmentVariableOperation(sample)) {
      conflicts.push({
        code: 'DEPLOY_PREFLIGHT_FLOW_ENVVAR_TARGET_CONFLICT',
        message: `Flow environment variable ${sample.target} in ${sample.path} has conflicting deploy mappings from ${parameterList}.`,
        details: {
          target: sample.target,
          parameters,
          operationKinds,
        },
      });
      continue;
    }

    if (isSharePointFileTextOperation(sample)) {
      conflicts.push({
        code: 'DEPLOY_PREFLIGHT_SHAREPOINT_TARGET_CONFLICT',
        message: `SharePoint file target ${sample.target} has conflicting deploy mappings from ${parameterList}.`,
        details: {
          target: sample.target,
          parameters,
          operationKinds,
        },
      });
      continue;
    }

    if (isPowerBiDatasetRefreshOperation(sample)) {
      conflicts.push({
        code: 'DEPLOY_PREFLIGHT_POWERBI_TARGET_CONFLICT',
        message: `Power BI dataset target ${sample.target} has conflicting deploy mappings from ${parameterList}.`,
        details: {
          target: sample.target,
          parameters,
          operationKinds,
        },
      });
      continue;
    }

    conflicts.push({
      code: 'DEPLOY_PREFLIGHT_BINDING_TARGET_CONFLICT',
      message: `Deploy binding target ${sample.target} has conflicting mappings from ${parameterList}.`,
      details: {
        target: sample.target,
        parameters,
        operationKinds,
      },
    });
  }

  return conflicts;
}

function getDeployConflictKey(operation: DeployOperationPlan): string {
  if (isDataverseEnvvarOperation(operation) || isDataverseEnvvarUpsertOperation(operation)) {
    return `dataverse-envvar:${(operation.environmentAlias ?? '').toLowerCase()}:${(operation.solutionUniqueName ?? operation.solutionAlias ?? '').toLowerCase()}:${operation.target.toLowerCase()}`;
  }

  if (isDataverseConnectionReferenceOperation(operation) || isDataverseConnectionReferenceUpsertOperation(operation)) {
    return `dataverse-connref:${(operation.environmentAlias ?? '').toLowerCase()}:${(operation.solutionUniqueName ?? operation.solutionAlias ?? '').toLowerCase()}:${operation.target.toLowerCase()}`;
  }

  if (isFlowParameterOperation(operation)) {
    return `flow-parameter:${operation.path.toLowerCase()}:${operation.target.toLowerCase()}`;
  }

  if (isFlowConnectionReferenceOperation(operation)) {
    return `flow-connref:${operation.path.toLowerCase()}:${operation.target.toLowerCase()}`;
  }

  if (isFlowEnvironmentVariableOperation(operation)) {
    return `flow-envvar:${operation.path.toLowerCase()}:${operation.target.toLowerCase()}`;
  }

  if (isSharePointFileTextOperation(operation)) {
    return `sharepoint:${operation.authProfile.toLowerCase()}:${operation.site.toLowerCase()}:${(operation.drive ?? '').toLowerCase()}:${operation.file.toLowerCase()}`;
  }

  if (isPowerBiDatasetRefreshOperation(operation)) {
    return `powerbi:${operation.authProfile.toLowerCase()}:${operation.workspace.toLowerCase()}:${operation.dataset.toLowerCase()}`;
  }

  return `binding:${operation.target.toLowerCase()}`;
}

function matchesDeployConflict(operation: DeployOperationPlan, conflict: DeployTargetConflict): boolean {
  if (!conflict.details.parameters.includes(operation.parameter)) {
    return false;
  }

  if (operation.target.toLowerCase() !== conflict.details.target.toLowerCase()) {
    return false;
  }

  switch (conflict.code) {
    case 'DEPLOY_PREFLIGHT_ENVVAR_TARGET_CONFLICT':
      return isDataverseEnvvarOperation(operation) || isDataverseEnvvarUpsertOperation(operation);
    case 'DEPLOY_PREFLIGHT_CONNREF_TARGET_CONFLICT':
      return isDataverseConnectionReferenceOperation(operation) || isDataverseConnectionReferenceUpsertOperation(operation);
    case 'DEPLOY_PREFLIGHT_FLOW_PARAMETER_TARGET_CONFLICT':
      return isFlowParameterOperation(operation);
    case 'DEPLOY_PREFLIGHT_FLOW_CONNREF_TARGET_CONFLICT':
      return isFlowConnectionReferenceOperation(operation);
    case 'DEPLOY_PREFLIGHT_FLOW_ENVVAR_TARGET_CONFLICT':
      return isFlowEnvironmentVariableOperation(operation);
    case 'DEPLOY_PREFLIGHT_SHAREPOINT_TARGET_CONFLICT':
      return isSharePointFileTextOperation(operation);
    case 'DEPLOY_PREFLIGHT_POWERBI_TARGET_CONFLICT':
      return isPowerBiDatasetRefreshOperation(operation);
    case 'DEPLOY_PREFLIGHT_BINDING_TARGET_CONFLICT':
      return operation.kind === 'deploy-input-bind' || operation.kind === 'deploy-secret-bind';
  }
}

export type ReleaseExecutionMode = DeployExecutionMode;

export interface ReleaseManifest {
  schemaVersion: 1;
  kind: 'pp.release';
  name: string;
  projectRoot?: string;
  bundle?: {
    id?: string;
    manifestPath?: string;
    generatedAt?: string;
  };
  metadata?: Record<string, string | number | boolean>;
  stages: ReleaseStageManifest[];
}

export interface ReleaseStageManifest {
  id: string;
  label?: string;
  projectPath?: string;
  stage?: string;
  planPath?: string;
  approvals?: ReleaseApprovalGate[];
  validations?: ReleaseValidationGate[];
  rollback?: ReleaseRollbackPolicy;
}

export interface ReleaseApprovalGate {
  id: string;
  required?: boolean;
  instructions?: string;
}

export type ReleaseValidationGate =
  | {
      id?: string;
      kind: 'preflight-ok';
      message?: string;
    }
  | {
      id?: string;
      kind: 'apply-summary';
      message?: string;
      minApplied?: number;
      maxFailed?: number;
      maxSkipped?: number;
      minChanged?: number;
      maxCreated?: number;
    }
  | {
      id?: string;
      kind: 'operation-status';
      message?: string;
      target?: string;
      parameter?: string;
      operationKind?: DeployOperationPlan['kind'];
      allowedStatuses: DeployOperationResult['status'][];
    };

export interface ReleaseRollbackPolicy {
  onFailure?: boolean;
}

export interface ReleaseApprovalResult {
  gate: ReleaseApprovalGate;
  required: boolean;
  approved: boolean;
  status: 'approved' | 'blocked';
}

export interface ReleaseValidationResult {
  gate: ReleaseValidationGate;
  status: 'pass' | 'fail';
  message: string;
  details?: Record<string, unknown>;
}

export interface ReleaseRollbackOperationResult {
  parameter: string;
  target: string;
  kind: DeployOperationPlan['kind'];
  changed: boolean;
  support: 'supported' | 'unsupported' | 'not-needed';
  reason?: string;
  rollbackValuePreview?: string | number | boolean;
}

export interface ReleaseRollbackResult {
  requested: boolean;
  status: 'not-requested' | 'planned' | 'applied' | 'blocked' | 'failed';
  supported: number;
  unsupported: number;
  operations: ReleaseRollbackOperationResult[];
  plan?: DeployPlan;
  execution?: DeployExecutionResult;
}

export interface ReleaseAuditEntry {
  timestamp: string;
  stageId?: string;
  event:
    | 'release-started'
    | 'stage-started'
    | 'stage-approved'
    | 'stage-blocked'
    | 'stage-deploy-completed'
    | 'stage-validation-passed'
    | 'stage-validation-failed'
    | 'stage-rollback-planned'
    | 'stage-rollback-applied'
    | 'stage-rollback-failed'
    | 'stage-completed'
    | 'release-completed';
  status: 'info' | 'pass' | 'warn' | 'fail';
  message: string;
  details?: Record<string, unknown>;
}

export interface ReleaseStageExecutionResult {
  stage: ReleaseStageManifest;
  mode: ReleaseExecutionMode;
  target?: DeployTarget;
  approval: {
    ok: boolean;
    gates: ReleaseApprovalResult[];
  };
  deploy?: DeployExecutionResult;
  validations: {
    ok: boolean;
    checks: ReleaseValidationResult[];
  };
  rollback: ReleaseRollbackResult;
  status: 'completed' | 'failed' | 'blocked' | 'rolled-back' | 'rollback-failed' | 'skipped';
}

export interface ReleaseExecutionResult {
  manifest: ReleaseManifest;
  mode: ReleaseExecutionMode;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  summary: {
    totalStages: number;
    completed: number;
    failed: number;
    blocked: number;
    rolledBack: number;
    rollbackFailed: number;
    skipped: number;
  };
  stages: ReleaseStageExecutionResult[];
  audit: ReleaseAuditEntry[];
}

export async function executeReleaseManifest(
  manifest: ReleaseManifest,
  options: {
    mode?: ReleaseExecutionMode;
    confirmed?: boolean;
    approvedStages?: string[];
    parameterOverrides?: Record<string, string>;
  } = {}
): Promise<OperationResult<ReleaseExecutionResult>> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const mode = options.mode ?? 'apply';
  const approvedStages = new Set((options.approvedStages ?? []).map((value) => value.toLowerCase()));
  const stages: ReleaseStageExecutionResult[] = [];
  const audit: ReleaseAuditEntry[] = [
    {
      timestamp: startedAt,
      event: 'release-started',
      status: 'info',
      message: `Started release ${manifest.name}.`,
      details: {
        mode,
        stageCount: manifest.stages.length,
      },
    },
  ];
  const diagnostics: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  let haltRemainingStages = false;

  for (const stage of manifest.stages) {
    if (haltRemainingStages) {
      stages.push({
        stage,
        mode,
        approval: {
          ok: false,
          gates: [],
        },
        validations: {
          ok: false,
          checks: [],
        },
        rollback: {
          requested: false,
          status: 'not-requested',
          supported: 0,
          unsupported: 0,
          operations: [],
        },
        status: 'skipped',
      });
      continue;
    }

    const stageStartedAt = new Date().toISOString();
    audit.push({
      timestamp: stageStartedAt,
      stageId: stage.id,
      event: 'stage-started',
      status: 'info',
      message: `Started release stage ${stage.id}.`,
      details: {
        projectPath: stage.projectPath,
        planPath: stage.planPath,
        stage: stage.stage,
      },
    });

    const approval = evaluateReleaseStageApprovals(stage, approvedStages);

    if (approval.ok) {
      audit.push({
        timestamp: new Date().toISOString(),
        stageId: stage.id,
        event: 'stage-approved',
        status: 'pass',
        message: `Release stage ${stage.id} passed approval gates.`,
      });
    } else {
      audit.push({
        timestamp: new Date().toISOString(),
        stageId: stage.id,
        event: 'stage-blocked',
        status: 'fail',
        message: `Release stage ${stage.id} is blocked by missing approvals.`,
        details: {
          gates: approval.gates.filter((gate) => gate.status === 'blocked').map((gate) => gate.gate.id),
        },
      });
      stages.push({
        stage,
        mode,
        approval,
        validations: {
          ok: false,
          checks: [],
        },
        rollback: {
          requested: false,
          status: 'not-requested',
          supported: 0,
          unsupported: 0,
          operations: [],
        },
        status: 'blocked',
      });
      haltRemainingStages = true;
      continue;
    }

    const deployExecution = await executeReleaseStageDeploy(stage, manifest, {
      mode,
      confirmed: options.confirmed,
      parameterOverrides: options.parameterOverrides,
    });

    diagnostics.push(...deployExecution.diagnostics);
    warnings.push(...deployExecution.warnings);

    if (!deployExecution.success || !deployExecution.data) {
      stages.push({
        stage,
        mode,
        approval,
        validations: {
          ok: false,
          checks: [],
        },
        rollback: {
          requested: false,
          status: 'not-requested',
          supported: 0,
          unsupported: 0,
          operations: [],
        },
        status: 'failed',
      });
      audit.push({
        timestamp: new Date().toISOString(),
        stageId: stage.id,
        event: 'stage-deploy-completed',
        status: 'fail',
        message: `Release stage ${stage.id} failed before deploy output was produced.`,
      });
      haltRemainingStages = true;
      continue;
    }

    audit.push({
      timestamp: new Date().toISOString(),
      stageId: stage.id,
      event: 'stage-deploy-completed',
      status: deployExecution.data.preflight.ok && deployExecution.data.apply.summary.failed === 0 ? 'pass' : 'fail',
      message: `Release stage ${stage.id} completed deploy orchestration.`,
      details: {
        preflightOk: deployExecution.data.preflight.ok,
        apply: deployExecution.data.apply.summary,
      },
    });

    const validationResult = evaluateReleaseStageValidations(stage, deployExecution.data);
    audit.push({
      timestamp: new Date().toISOString(),
      stageId: stage.id,
      event: validationResult.ok ? 'stage-validation-passed' : 'stage-validation-failed',
      status: validationResult.ok ? 'pass' : 'fail',
      message: validationResult.ok
        ? `Release stage ${stage.id} passed post-deploy validation.`
        : `Release stage ${stage.id} failed post-deploy validation.`,
      details: {
        failedChecks: validationResult.checks.filter((check) => check.status === 'fail').map((check) => check.message),
      },
    });

    const stageFailed = !deployExecution.data.preflight.ok || deployExecution.data.apply.summary.failed > 0 || !validationResult.ok;
    const rollback = await maybeExecuteReleaseRollback(stage, deployExecution.data, {
      mode,
      confirmed: options.confirmed,
    });

    if (rollback.requested && rollback.status === 'planned') {
      audit.push({
        timestamp: new Date().toISOString(),
        stageId: stage.id,
        event: 'stage-rollback-planned',
        status: 'warn',
        message: `Release stage ${stage.id} produced a rollback plan.`,
        details: {
          supported: rollback.supported,
          unsupported: rollback.unsupported,
        },
      });
    }

    if (rollback.status === 'applied') {
      audit.push({
        timestamp: new Date().toISOString(),
        stageId: stage.id,
        event: 'stage-rollback-applied',
        status: 'pass',
        message: `Release stage ${stage.id} applied rollback.`,
        details: {
          supported: rollback.supported,
          unsupported: rollback.unsupported,
        },
      });
    } else if (rollback.status === 'failed' || rollback.status === 'blocked') {
      audit.push({
        timestamp: new Date().toISOString(),
        stageId: stage.id,
        event: 'stage-rollback-failed',
        status: 'fail',
        message:
          rollback.status === 'blocked'
            ? `Release stage ${stage.id} could not execute rollback for all changed operations.`
            : `Release stage ${stage.id} rollback execution failed.`,
        details: {
          supported: rollback.supported,
          unsupported: rollback.unsupported,
        },
      });
    }

    const stageStatus: ReleaseStageExecutionResult['status'] = !stageFailed
      ? 'completed'
      : rollback.status === 'applied'
        ? 'rolled-back'
        : rollback.status === 'failed' || rollback.status === 'blocked'
          ? 'rollback-failed'
          : 'failed';

    stages.push({
      stage,
      mode,
      target: deployExecution.data.target,
      approval,
      deploy: deployExecution.data,
      validations: validationResult,
      rollback,
      status: stageStatus,
    });

    audit.push({
      timestamp: new Date().toISOString(),
      stageId: stage.id,
      event: 'stage-completed',
      status: stageStatus === 'completed' || stageStatus === 'rolled-back' ? 'pass' : 'fail',
      message: `Release stage ${stage.id} finished with status ${stageStatus}.`,
    });

    if (stageFailed) {
      haltRemainingStages = true;
    }
  }

  const finishedAt = new Date().toISOString();
  audit.push({
    timestamp: finishedAt,
    event: 'release-completed',
    status: stages.some((stage) => stage.status === 'failed' || stage.status === 'blocked' || stage.status === 'rollback-failed')
      ? 'fail'
      : 'pass',
    message: `Release ${manifest.name} finished.`,
  });

  return ok(
    {
      manifest,
      mode,
      startedAt,
      finishedAt,
      durationMs: Date.now() - startedAtMs,
      summary: {
        totalStages: stages.length,
        completed: stages.filter((stage) => stage.status === 'completed').length,
        failed: stages.filter((stage) => stage.status === 'failed').length,
        blocked: stages.filter((stage) => stage.status === 'blocked').length,
        rolledBack: stages.filter((stage) => stage.status === 'rolled-back').length,
        rollbackFailed: stages.filter((stage) => stage.status === 'rollback-failed').length,
        skipped: stages.filter((stage) => stage.status === 'skipped').length,
      },
      stages,
      audit,
    },
    {
      diagnostics,
      warnings,
      supportTier: 'preview',
      knownLimitations: [
        'Rollback is only executable for operation kinds that preserve a concrete prior value in the deploy result.',
        'SharePoint file uploads, Power BI dataset refreshes, and create-first Dataverse operations currently report rollback support limits instead of pretending to be symmetric.',
      ],
    }
  );
}

function evaluateReleaseStageApprovals(stage: ReleaseStageManifest, approvedStages: Set<string>): {
  ok: boolean;
  gates: ReleaseApprovalResult[];
} {
  const gates = (stage.approvals ?? []).map((gate) => {
    const required = gate.required !== false;
    const approved = !required || approvedStages.has(gate.id.toLowerCase()) || approvedStages.has(stage.id.toLowerCase());
    return {
      gate,
      required,
      approved,
      status: approved ? 'approved' : 'blocked',
    } satisfies ReleaseApprovalResult;
  });

  return {
    ok: gates.every((gate) => gate.approved),
    gates,
  };
}

async function executeReleaseStageDeploy(
  stage: ReleaseStageManifest,
  manifest: ReleaseManifest,
  options: {
    mode: ReleaseExecutionMode;
    confirmed?: boolean;
    parameterOverrides?: Record<string, string>;
  }
): Promise<OperationResult<DeployExecutionResult>> {
  if (stage.planPath) {
    const savedPlan = await loadReleaseDeployPlan(stage.planPath);

    if (!savedPlan.success || !savedPlan.data) {
      return savedPlan as unknown as OperationResult<DeployExecutionResult>;
    }

    return executeDeployPlan(savedPlan.data, {
      mode: options.mode,
      confirmed: options.confirmed,
      parameterOverrides: options.parameterOverrides,
    });
  }

  const projectPath = resolveReleaseProjectPath(manifest, stage);
  const project = await discoverProject(projectPath, {
    stage: stage.stage,
    parameterOverrides: options.parameterOverrides,
    environment: process.env,
  });

  if (!project.success || !project.data) {
    return project as unknown as OperationResult<DeployExecutionResult>;
  }

  return executeDeploy(project.data, {
    mode: options.mode,
    confirmed: options.confirmed,
  });
}

function evaluateReleaseStageValidations(stage: ReleaseStageManifest, deploy: DeployExecutionResult): {
  ok: boolean;
  checks: ReleaseValidationResult[];
} {
  const checks = (stage.validations ?? []).map((gate) => evaluateReleaseValidationGate(gate, deploy));
  return {
    ok: checks.every((check) => check.status === 'pass'),
    checks,
  };
}

function evaluateReleaseValidationGate(gate: ReleaseValidationGate, deploy: DeployExecutionResult): ReleaseValidationResult {
  if (gate.kind === 'preflight-ok') {
    return {
      gate,
      status: deploy.preflight.ok ? 'pass' : 'fail',
      message: gate.message ?? (deploy.preflight.ok ? 'Deploy preflight succeeded.' : 'Deploy preflight failed.'),
      details: {
        checkCount: deploy.preflight.checks.length,
      },
    };
  }

  if (gate.kind === 'apply-summary') {
    const summary = deploy.apply.summary;
    const failures: string[] = [];

    if (gate.minApplied !== undefined && summary.applied < gate.minApplied) {
      failures.push(`expected applied >= ${gate.minApplied} but got ${summary.applied}`);
    }
    if (gate.maxFailed !== undefined && summary.failed > gate.maxFailed) {
      failures.push(`expected failed <= ${gate.maxFailed} but got ${summary.failed}`);
    }
    if (gate.maxSkipped !== undefined && summary.skipped > gate.maxSkipped) {
      failures.push(`expected skipped <= ${gate.maxSkipped} but got ${summary.skipped}`);
    }
    if (gate.minChanged !== undefined && summary.changed < gate.minChanged) {
      failures.push(`expected changed >= ${gate.minChanged} but got ${summary.changed}`);
    }
    if (gate.maxCreated !== undefined && summary.created > gate.maxCreated) {
      failures.push(`expected created <= ${gate.maxCreated} but got ${summary.created}`);
    }

    return {
      gate,
      status: failures.length === 0 ? 'pass' : 'fail',
      message: gate.message ?? (failures.length === 0 ? 'Deploy apply summary matched validation gate.' : failures.join('; ')),
      details: {
        attempted: summary.attempted,
        applied: summary.applied,
        created: summary.created,
        failed: summary.failed,
        skipped: summary.skipped,
        changed: summary.changed,
        resolved: summary.resolved,
      },
    };
  }

  const matches = deploy.apply.operations.filter((operation) => {
    if (gate.target && operation.target !== gate.target) {
      return false;
    }
    if (gate.parameter && operation.parameter !== gate.parameter) {
      return false;
    }
    if (gate.operationKind && operation.kind !== gate.operationKind) {
      return false;
    }
    return true;
  });

  if (matches.length === 0) {
    return {
      gate,
      status: 'fail',
      message: gate.message ?? 'No deploy operations matched the validation selector.',
    };
  }

  const failing = matches.filter((operation) => !gate.allowedStatuses.includes(operation.status));
  return {
    gate,
    status: failing.length === 0 ? 'pass' : 'fail',
    message:
      gate.message ??
      (failing.length === 0
        ? 'Matched deploy operations stayed within the allowed statuses.'
        : `Matched deploy operations had disallowed statuses: ${failing.map((operation) => `${operation.kind}:${operation.status}`).join(', ')}`),
    details: {
      matched: matches.length,
      failing: failing.map((operation) => ({
        kind: operation.kind,
        target: operation.target,
        status: operation.status,
      })),
    },
  };
}

async function maybeExecuteReleaseRollback(
  stage: ReleaseStageManifest,
  deploy: DeployExecutionResult,
  options: {
    mode: ReleaseExecutionMode;
    confirmed?: boolean;
  }
): Promise<ReleaseRollbackResult> {
  if (stage.rollback?.onFailure !== true) {
    return {
      requested: false,
      status: 'not-requested',
      supported: 0,
      unsupported: 0,
      operations: [],
    };
  }

  const rollbackPlan = buildReleaseRollbackPlan(deploy, options.mode);
  const supported = rollbackPlan.operations.filter((operation) => operation.support === 'supported').length;
  const unsupported = rollbackPlan.operations.filter((operation) => operation.support === 'unsupported').length;

  if (!rollbackPlan.plan) {
    return {
      requested: true,
      status: unsupported > 0 ? 'blocked' : 'not-requested',
      supported,
      unsupported,
      operations: rollbackPlan.operations,
    };
  }

  if (options.mode !== 'apply') {
    return {
      requested: true,
      status: 'planned',
      supported,
      unsupported,
      operations: rollbackPlan.operations,
      plan: rollbackPlan.plan,
    };
  }

  const execution = await executeDeployPlan(rollbackPlan.plan, {
    mode: 'apply',
    confirmed: options.confirmed,
  });

  if (!execution.success || !execution.data) {
    return {
      requested: true,
      status: 'failed',
      supported,
      unsupported,
      operations: rollbackPlan.operations,
      plan: rollbackPlan.plan,
    };
  }

  return {
    requested: true,
    status: execution.data.preflight.ok && execution.data.apply.summary.failed === 0 ? 'applied' : 'failed',
    supported,
    unsupported,
    operations: rollbackPlan.operations,
    plan: rollbackPlan.plan,
    execution: execution.data,
  };
}

function buildReleaseRollbackPlan(
  deploy: DeployExecutionResult,
  mode: ReleaseExecutionMode
): {
  operations: ReleaseRollbackOperationResult[];
  plan?: DeployPlan;
} {
  const rollbackOperations: DeployOperationPlan[] = [];
  const operations = deploy.apply.operations.map((operation) => {
    const shouldRollback =
      (mode === 'apply' ? operation.status === 'applied' : operation.status === 'planned') && operation.changed === true;

    if (!shouldRollback) {
      return {
        parameter: operation.parameter,
        target: operation.target,
        kind: operation.kind,
        changed: false,
        support: 'not-needed',
        reason: 'Operation did not change target state in this execution mode.',
      } satisfies ReleaseRollbackOperationResult;
    }

    const rollbackOperation = toRollbackOperationPlan(operation);

    if (!rollbackOperation) {
      return {
        parameter: operation.parameter,
        target: operation.target,
        kind: operation.kind,
        changed: true,
        support: 'unsupported',
        reason: describeRollbackUnsupportedReason(operation),
      } satisfies ReleaseRollbackOperationResult;
    }

    rollbackOperations.push(rollbackOperation);
    return {
      parameter: operation.parameter,
      target: operation.target,
      kind: operation.kind,
      changed: true,
      support: 'supported',
      rollbackValuePreview: rollbackOperation.valuePreview,
    } satisfies ReleaseRollbackOperationResult;
  });

  if (rollbackOperations.length === 0) {
    return {
      operations,
    };
  }

  return {
    operations,
    plan: {
      ...deploy.plan,
      generatedAt: new Date().toISOString(),
      operations: rollbackOperations,
    },
  };
}

function toRollbackOperationPlan(operation: DeployOperationResult): DeployOperationPlan | undefined {
  if (operation.currentValue === undefined) {
    return undefined;
  }

  if (operation.kind === 'dataverse-envvar-set') {
    return {
      ...operation,
      kind: 'dataverse-envvar-set',
      valuePreview: operation.currentValue,
    };
  }

  if (operation.kind === 'dataverse-envvar-upsert') {
    if (operation.created === true) {
      return undefined;
    }
    return {
      ...operation,
      kind: 'dataverse-envvar-set',
      valuePreview: operation.currentValue,
    };
  }

  if (operation.kind === 'dataverse-connref-set') {
    return {
      ...operation,
      kind: 'dataverse-connref-set',
      valuePreview: operation.currentValue,
    };
  }

  if (operation.kind === 'dataverse-connref-upsert') {
    if (operation.created === true) {
      return undefined;
    }
    return {
      ...operation,
      kind: 'dataverse-connref-set',
      valuePreview: operation.currentValue,
    };
  }

  if (operation.kind === 'flow-parameter-set') {
    return {
      ...operation,
      kind: 'flow-parameter-set',
      valuePreview: operation.currentValue,
    };
  }

  if (operation.kind === 'flow-connref-set') {
    return {
      ...operation,
      kind: 'flow-connref-set',
      valuePreview: operation.currentValue,
    };
  }

  if (operation.kind === 'flow-envvar-set') {
    return {
      ...operation,
      kind: 'flow-envvar-set',
      valuePreview: operation.currentValue,
    };
  }

  return undefined;
}

function describeRollbackUnsupportedReason(operation: DeployOperationResult): string {
  switch (operation.kind) {
    case 'dataverse-envvar-upsert':
    case 'dataverse-connref-upsert':
      return operation.created === true
        ? 'Create-first Dataverse operations do not yet have a symmetric delete rollback path.'
        : 'Rollback needs a preserved prior value and compatible set operation.';
    case 'sharepoint-file-text-set':
      return 'SharePoint file deploy does not persist previous content for rollback.';
    case 'powerbi-dataset-refresh':
      return 'A dataset refresh request is not a symmetric rollback operation.';
    case 'deploy-input-bind':
    case 'deploy-secret-bind':
      return 'Adapter binding resolution is not a remote mutation.';
    default:
      return 'Rollback is not supported for this deploy operation kind.';
  }
}

function resolveReleaseProjectPath(manifest: ReleaseManifest, stage: ReleaseStageManifest): string {
  if (stage.projectPath) {
    return stage.projectPath;
  }

  if (manifest.projectRoot) {
    return manifest.projectRoot;
  }

  return process.cwd();
}

async function loadReleaseDeployPlan(path: string): Promise<OperationResult<DeployPlan>> {
  try {
    const raw = await import('node:fs/promises').then((fs) => fs.readFile(path, 'utf8'));
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== 'object') {
      return fail(createDiagnostic('error', 'RELEASE_DEPLOY_PLAN_INVALID', `Deploy plan ${path} is not an object.`, { source: '@pp/deploy' }));
    }

    if (!isDeployPlanShapeForRelease(parsed)) {
      return fail(
        createDiagnostic('error', 'RELEASE_DEPLOY_PLAN_INVALID', `Deploy plan ${path} does not match the expected deploy plan shape.`, {
          source: '@pp/deploy',
          path,
        })
      );
    }

    return ok(parsed, {
      supportTier: 'preview',
    });
  } catch (error) {
    return fail(
      createDiagnostic('error', 'RELEASE_DEPLOY_PLAN_READ_FAILED', `Could not load deploy plan ${path}.`, {
        source: '@pp/deploy',
        path,
        hint: error instanceof Error ? error.message : undefined,
      })
    );
  }
}

function isDeployPlanShapeForRelease(value: unknown): value is DeployPlan {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<DeployPlan>;
  return typeof candidate.projectRoot === 'string' && typeof candidate.generatedAt === 'string' && Array.isArray(candidate.operations);
}
