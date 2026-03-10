import { resolve as resolvePath } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { ParameterMapping } from '@pp/config';
import { ConnectionReferenceService, EnvironmentVariableService, resolveDataverseClient } from '@pp/dataverse';
import { createDiagnostic, ok, type Diagnostic, type OperationResult } from '@pp/diagnostics';
import { loadFlowArtifact, patchFlowArtifact, type FlowArtifact } from '@pp/flow';
import { summarizeResolvedParameter, type ProjectContext, type ResolvedProjectParameter } from '@pp/project';
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

export type DeployOperationPlan =
  | DataverseEnvvarDeployOperationPlan
  | DataverseEnvvarUpsertDeployOperationPlan
  | DataverseConnectionReferenceDeployOperationPlan
  | DataverseConnectionReferenceUpsertDeployOperationPlan
  | DeployInputBindingOperationPlan
  | DeploySecretBindingOperationPlan
  | FlowParameterDeployOperationPlan;

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
    | 'DEPLOY_PREFLIGHT_FLOW_PARAMETER_TARGET_CONFLICT';
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

interface PreparedDeployOperation {
  plan: DeployOperationPlan;
  value?: DeployPrimitiveValue;
  executable: boolean;
  blockedCode?: 'DEPLOY_PREFLIGHT_PLAN_OPERATION_VALUE_MISSING' | 'DEPLOY_PREFLIGHT_PLAN_OPERATION_VALUE_REDACTED';
  blockedMessage?: string;
}

function isPreparedFlowParameterOperation(
  operation: PreparedDeployOperation
): operation is PreparedDeployOperation & { plan: FlowParameterDeployOperationPlan; value?: DeployPrimitiveValue } {
  return isFlowParameterOperation(operation.plan);
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
  const diagnostics: Diagnostic[] = collectStaticMappingChecks(project).map((check) =>
    createDiagnostic('error', check.code, check.message, {
      source: '@pp/deploy',
      ...check.details,
    })
  );
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
  const flowOperations = preparedOperations.filter(isPreparedFlowParameterOperation);
  const adapterBindingOperations = preparedOperations.filter(
    (operation) => !isDataverseMutationOperation(operation.plan) && !isFlowParameterOperation(operation.plan)
  );
  const runnableDataverseOperations: PreparedDeployOperation[] = [];
  const runnableFlowOperations: FlowParameterDeployTargetInspection[] = [];

  checks.push(
    ...conflicts.map((conflict) => ({
      status: 'fail' as const,
      code: conflict.code,
      message: conflict.message,
      target: conflict.details.target,
      details: conflict.details,
    }))
  );

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

    const artifact = await loadFlowArtifact(operation.plan.path);

    if (!artifact.success || !artifact.data) {
      diagnostics.push(...artifact.diagnostics);
      warnings.push(...artifact.warnings);
      checks.push({
        status: 'fail',
        code: 'DEPLOY_PREFLIGHT_FLOW_PARAMETER_ASSET_INVALID',
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

  if ((runnableDataverseOperations.length === 0 && runnableFlowOperations.length === 0) || !plan) {
    return ok(finalizeDeployExecution(mode, target, plan, bindings, confirmation, checks, applyOperations, startedAt), {
      supportTier: 'preview',
      diagnostics,
      warnings,
    });
  }
  const dataverseGroups = groupPreparedDataverseOperations(runnableDataverseOperations, target);

  for (const group of dataverseGroups) {
    const resolution = await resolveDataverseClient(group.environmentAlias);

    if (!resolution.success || !resolution.data) {
      diagnostics.push(...resolution.diagnostics);
      warnings.push(...resolution.warnings);
      checks.push({
        status: 'fail',
        code: 'DEPLOY_PREFLIGHT_DATAVERSE_RESOLUTION_FAILED',
        message: `Could not resolve Dataverse environment alias ${group.environmentAlias}.`,
        target: group.environmentAlias,
        details: {
          solution: group.solutionUniqueName,
        },
      });
      continue;
    }

    const solutionService = new SolutionService(resolution.data.client);
    const connectionReferences = new ConnectionReferenceService(resolution.data.client);
    const environmentVariables = new EnvironmentVariableService(resolution.data.client);
    const [analysis, references, variables] = await Promise.all([
      solutionService.analyze(group.solutionUniqueName),
      connectionReferences.list({ solutionUniqueName: group.solutionUniqueName }),
      environmentVariables.list({ solutionUniqueName: group.solutionUniqueName }),
    ]);

    if (!analysis.success) {
      diagnostics.push(...analysis.diagnostics);
      warnings.push(...analysis.warnings);
      checks.push({
        status: 'fail',
        code: 'DEPLOY_PREFLIGHT_SOLUTION_ANALYZE_FAILED',
        message: `Failed to analyze solution ${group.solutionUniqueName} before deploy.`,
        target: group.solutionUniqueName,
      });
    }

    if (!variables.success) {
      diagnostics.push(...variables.diagnostics);
      warnings.push(...variables.warnings);
      checks.push({
        status: 'fail',
        code: 'DEPLOY_PREFLIGHT_ENVVAR_DISCOVERY_FAILED',
        message: `Failed to inspect environment variables for solution ${group.solutionUniqueName}.`,
        target: group.solutionUniqueName,
      });
    }

    if (!references.success) {
      diagnostics.push(...references.diagnostics);
      warnings.push(...references.warnings);
      checks.push({
        status: 'fail',
        code: 'DEPLOY_PREFLIGHT_CONNREF_DISCOVERY_FAILED',
        message: `Failed to inspect connection references for solution ${group.solutionUniqueName}.`,
        target: group.solutionUniqueName,
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

    if (analysis.success) {
      if (!solutionAnalysis) {
        checks.push({
          status: 'fail',
          code: 'DEPLOY_PREFLIGHT_SOLUTION_NOT_FOUND',
          message: `Solution ${group.solutionUniqueName} was not found in ${group.environmentAlias}.`,
          target: group.solutionUniqueName,
        });
      } else {
        checks.push({
          status: 'pass',
          code: 'DEPLOY_PREFLIGHT_SOLUTION_FOUND',
          message: `Solution ${group.solutionUniqueName} is available in ${group.environmentAlias}.`,
          target: group.solutionUniqueName,
        });

        if (solutionAnalysis.invalidConnectionReferences.length > 0) {
          checks.push({
            status: 'warn',
            code: 'DEPLOY_PREFLIGHT_CONNECTION_REFS_INVALID',
            message: `Solution ${group.solutionUniqueName} has ${solutionAnalysis.invalidConnectionReferences.length} invalid connection reference(s).`,
            target: group.solutionUniqueName,
          });
        }

        if (solutionAnalysis.missingEnvironmentVariables.length > 0) {
          checks.push({
            status: 'warn',
            code: 'DEPLOY_PREFLIGHT_ENVVARS_MISSING_VALUES',
            message: `Solution ${group.solutionUniqueName} has ${solutionAnalysis.missingEnvironmentVariables.length} environment variable(s) without an effective value.`,
            target: group.solutionUniqueName,
          });
        }
      }
    }

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
    default:
      return undefined;
  }
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
    case 'DEPLOY_PREFLIGHT_BINDING_TARGET_CONFLICT':
      return operation.kind === 'deploy-input-bind' || operation.kind === 'deploy-secret-bind';
  }
}
